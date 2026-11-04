import assert from "node:assert/strict";
import test from "node:test";
import neo4j, { type Driver } from "neo4j-driver";
import user from "./getUserContributions.js";
import mod from "./getModContributions.js";
import channel from "./getChannelContributions.js";

for(const value of [0,7,neo4j.int(0),neo4j.int(7)]) {
  test(`contribution normalization preserves ${neo4j.isInt(value)?'driver':'native'} ${String(value)}`,async()=>{
    const expected=neo4j.isInt(value)?value.toNumber():value;
    const values={date:'2026-01-02',count:value,activities:[],username:'actor',displayName:null,profilePicURL:null,totalContributions:value,dayData:[{date:null,count:0,activities:[]},{date:'2026-01-02',count:value,activities:[]}]};
    const driver={session:()=>({run:async()=>({records:[new neo4j.Record(Object.keys(values),Object.values(values))]}),close:async()=>{}})} as unknown as Driver;
    const contributionTargetRepository={userExists:async()=>true,moderationProfileExists:async()=>true,channelExists:async()=>true};
    const input={driver,contributionTargetRepository};const context={driver,mayAccessSensitiveContent:true};
    assert.equal((await user(input)(null,{username:'actor'},context))[0].count,expected);
    assert.equal((await mod(input)(null,{displayName:'moderator'},context))[0].count,expected);
    const result=await channel(input)(null,{channelUniqueName:'forum'},context);
    assert.equal(result[0].totalContributions,expected);assert.equal(result[0].dayData.length,1);
    assert.equal(result[0].dayData[0].count,value,'nested count is deliberately not normalized');
  });
}
