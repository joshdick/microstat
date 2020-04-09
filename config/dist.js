const moment = require('moment');
const raw = require('config/raw').raw;

// ***Copy this file to `config/local.js` and change the copy to fit your site and needs.***

// Override the implementation of this function to fit your needs.
// See `posts.generators.filename` below for more details.
const generatePostFilename = (timestamp, slug) => {
  const suffix = slug ? `_${slug}` : '';
  const postDate = moment(timestamp).format('YYYY/MM/DD_HH.mm.ss');
  return `${postDate}${suffix}.md`;
};

// Override the implementation of this function to fit your needs.
// See `posts.generators.url` below for more details.
const generatePostUrl = (timestamp, slug) => {
  const filename = generatePostFilename(timestamp, slug);
  return `https://example.com/microblog/${filename.replace(/\.md$/, '.html')}`;
};

module.exports = {
  app: {
    //Which local TCP port the server should listen on.
    listenPort: 8080,

    // URL of an RSS/Atom/JSON feed that will contain Microblog posts after `app.publishCommand` runs.
    // If set, will ping [micro.blog](https://micro.blog) with that feed, informing micro.blog to check for new posts.
    // If you don't use https://micro.blog, leave this value empty.
    microblogPingFeedURL: '',

    // Local path to a script that will consume written Microblog posts
    // (Markdown files) and media files written to `app.siteRoot` (below) and publish them to the Internet,
    // commit changes to your site to Git, etc.
    publishCommand: '/path/to/a/script',
  },
  site: {
    indieauth: {
      // Your IndieAuth-enabled website; will be used as the IndieAuth identity.
      identity: 'https://example.com',

      // IndieAuth token endpoint.
      // If your website includes a `<link rel="token_endpoint">` tag, duplicate its value here.
      tokenEndpoint: 'https://tokens.indieauth.com/token',
    },

    // Local path to the source of your statically-generated site.
    // All local paths configured in the `posts` and `media` sections below will be treated as relative to this path.
    root: '/path/to/your/site',
  },
  posts: {
    generators: {
      // Function that generates post URLs that correspond to where
      // posts will appear on your site after `app.publishCommand` runs.
      url: raw(generatePostUrl),

      // Function that generates a unique filename for each post, relative to `site.root`.
      // Directories should be separated by forward slashes
      // and will be automatically created if they don't exist in the fileystem.
      filename: raw(generatePostFilename),
    },

    // If nonempty, will include the configured Jekyll-style layout name in each post.
    layoutName: '',

    tags: {
      // The key that tag values will be assigned to in the generated front matter of each post.
      key: 'tags',

      // Controls the format of the tags list in the generated front matter of each post.
      // Valid values are `space_delimited` (Jekyll style) or `yaml_list` (Hugo style).
      style: 'space_delimited',
    },
  },
  media: {},
};
