import snoowrap from 'snoowrap';

type Args = {
  subredditName: string;
  options?: {
    offset?: number;
    limit?: number;
    sort?: string;
  };
}

const getSubredditResolver = () => {
  return async (parent: any, args: Args, context: any, info: any) => {
    const { subredditName, options } = args;

    const r = new snoowrap({
        userAgent: 'web:Listical:v1.0 (by /u/gennitdev)',
        clientId: process.env.REDDIT_CLIENT_ID,
        clientSecret: process.env.REDDIT_CLIENT_SECRET,
        refreshToken: process.env.REDDIT_REFRESH_TOKEN
    })

    // Fetch subreddit metadata
    // @ts-ignore
    const metadata = await r.getSubreddit(subredditName).fetch();

    // @ts-ignore
    let linkFlairs = [];
    // @ts-ignore
    let rules = [];

    try {
      // Fetch link flairs for the subreddit
      // @ts-ignore
      linkFlairs = await r.oauthRequest({
        uri: `/r/${subredditName}/api/link_flair_v2.json`,
        method: 'GET'
      });

      // Fetch the rules of the subreddit
      // @ts-ignore
      rules = await r.oauthRequest({
        uri: `/r/${subredditName}/about/rules.json`,
        method: 'GET'
      });
    } catch (error) {
      console.error(`Failed to fetch link flairs for subreddit ${subredditName}: ${error}`);
      // If there's an error (e.g., no permission), linkFlairs will remain an empty array
    }

    const result = {
        title: metadata.title,
        displayName: metadata.display_name,
        allowGalleries: metadata.allow_galleries,
        shortDescription: metadata.public_description, // 500 characters max
        longDescription: metadata.description, // 5120 characters max
        communityIcon: metadata.community_icon,
        showMediaPreview: metadata.show_media_preview,
        bannerImg: metadata.banner_background_image,
        allowImages: metadata.allow_images,
        linkFlairs: linkFlairs,
        rules: rules
    }

    return result;
  };
};

export default getSubredditResolver;
