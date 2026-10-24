import assert from 'node:assert/strict';
import {before,beforeEach,after,test} from 'node:test';
import type {Driver} from 'neo4j-driver';
import {
  writeDiscussionAlbum,
  connectCreatedDiscussionAlbumOwnership,
  albumImageScalars,
} from '../../services/persistence/discussionAlbumWrite.js';
import {startNeo4j,stopNeo4j,resetDatabase} from './neo4jHarness.js';

// FAMILY-3 / v7 (campaign #284). Direct coverage of the owned album-write Cypher
// used by the discussion create/update resolvers, since the resolver-level album
// nesting path has no integration test of its own.
let driver:Driver;
before(async()=>{driver=await startNeo4j();},{timeout:240_000});
beforeEach(async()=>{await resetDatabase(driver);});
after(async()=>{await stopNeo4j();});

const seed=async()=>driver.executeQuery("CREATE (:User {username:'alice',createdAt:datetime()}),(:Discussion {id:'d',title:'D',createdAt:datetime()})");
const album=async()=>(await driver.executeQuery(`
  MATCH (d:Discussion {id:'d'})-[:HAS_ALBUM]->(a:Album)
  OPTIONAL MATCH (owner:User)-[:HAS_ALBUM]->(a)
  OPTIONAL MATCH (a)-[:HAS_IMAGE]->(img:Image)
  OPTIONAL MATCH (up:User)-[:UPLOADED_IMAGE]->(img)
  RETURN a.imageOrder AS imageOrder, owner.username AS owner,
         collect(DISTINCT {url:img.url, scanStatus:img.scanStatus, uploader:up.username}) AS images
`)).records.map(r=>r.toObject());

test('albumImageScalars strips the Uploader connect and node wrapper',()=>{
  assert.deepEqual(albumImageScalars({create:[{node:{url:'u1',Uploader:{connect:{where:{node:{username:'x'}}}}}}]}),[{url:'u1'}]);
  assert.deepEqual(albumImageScalars({create:{node:{url:'u2'}}}),[{url:'u2'}]);
  assert.deepEqual(albumImageScalars(undefined),[]);
});

test('create mode builds the album, owner and image uploader edges',async()=>{
  await seed();
  await driver.session().executeWrite(tx=>writeDiscussionAlbum(tx,{discussionId:'d',username:'alice',mode:'create',imageOrder:['i1'],images:[{url:'i1'}]}));
  const rows=await album();
  assert.equal(rows.length,1);
  assert.equal(rows[0].owner,'alice');
  assert.deepEqual(rows[0].imageOrder,['i1']);
  assert.equal(rows[0].images.length,1);
  assert.equal(rows[0].images[0].url,'i1');
  assert.equal(rows[0].images[0].scanStatus,'PENDING');
  assert.equal(rows[0].images[0].uploader,'alice');
});

test('update mode appends an image to the existing album and sets its uploader',async()=>{
  await seed();
  await driver.session().executeWrite(tx=>writeDiscussionAlbum(tx,{discussionId:'d',username:'alice',mode:'create',imageOrder:['i1'],images:[{url:'i1'}]}));
  await driver.session().executeWrite(tx=>writeDiscussionAlbum(tx,{discussionId:'d',username:'alice',mode:'update',imageOrder:['i1','i2'],images:[{url:'i2'}]}));
  const rows=await album();
  assert.equal(rows.length,1);
  assert.deepEqual(rows[0].imageOrder,['i1','i2']);
  assert.equal(rows[0].images.length,2);
  assert.deepEqual(rows[0].images.map((i:any)=>i.uploader).sort(),['alice','alice']);
});

test('connectCreatedDiscussionAlbumOwnership wires owner and uploader on a pre-created album',async()=>{
  await seed();
  // Simulate what the generated nested create produced: an album + image with no owner edges.
  await driver.executeQuery("MATCH (d:Discussion {id:'d'}) CREATE (d)-[:HAS_ALBUM]->(a:Album {id:'al'})-[:HAS_IMAGE]->(:Image {id:'im',url:'i1'})");
  await driver.session().executeWrite(tx=>connectCreatedDiscussionAlbumOwnership(tx,{discussionId:'d',username:'alice'}));
  const rows=await album();
  assert.equal(rows[0].owner,'alice');
  assert.equal(rows[0].images[0].uploader,'alice');
});
