import { execSync } from 'child_process';
import { existsSync, unlink, writeFile } from 'fs';
import { resolve as pathResolve, dirname as pathDirname } from 'path';
import * as querystring from 'querystring';
import { promisify } from 'util';

import axios from 'axios';
import * as express from 'express';
import * as Minilog from 'minilog';
const MicropubFormatter = require('format-microformat'); // eslint-disable-line @typescript-eslint/no-var-requires
import * as moment from 'moment';
const micropub = require('micropub-express'); // eslint-disable-line @typescript-eslint/no-var-requires
import * as mkdirp from 'mkdirp';
const webmention = require('send-webmention'); // eslint-disable-line @typescript-eslint/no-var-requires

const unlinkAsync = promisify(unlink);
const writeFileAsync = promisify(writeFile);

const log = Minilog('microstat');
Minilog.enable();

const handleFatalError = (error: string): void => {
  log.error(error);
  process.exit(1);
};

// Validate configuration.
// `..` will either be the 'src' or 'dist' folder depending on how microstat is started.
const CONFIG_PATH = pathResolve(`${pathDirname(require.main.filename)}/../config/config`);
if (!existsSync(CONFIG_PATH)) {
  handleFatalError(`Couldn't read configuration!

Please copy ${CONFIG_PATH}.dist to ${CONFIG_PATH}
and modify the values as described in the comments.
`);
}
require('dotenv').config({ path: CONFIG_PATH });

// Validate post tags style configuration.
const POST_TAG_STYLES = Object.freeze({
  SPACE_DELIMITED: Symbol('tag_style:space_delimited'),
  YAML_LIST: Symbol('tag_style:yaml_list'),
});

let postTagsStyle = POST_TAG_STYLES.SPACE_DELIMITED;
if (process.env.POST_TAGS_STYLE) {
  const configuredPostTagStyle = process.env.POST_TAGS_STYLE.toLocaleUpperCase();
  if (!POST_TAG_STYLES[configuredPostTagStyle]) {
    handleFatalError(`Configured POST_TAG_STYLE is invalid!

Please reconfigure POST_TAG_STYLE to be one of the values specified in ${CONFIG_PATH}.dist.
`);
  }
  postTagsStyle = POST_TAG_STYLES[configuredPostTagStyle];
}

// Validate post URL template.
const POST_URL_TEMPLATE_REGEX = /\$\{postName\}/;
if (!(process.env.POST_URL_TEMPLATE || '').match(POST_URL_TEMPLATE_REGEX)) {
  handleFatalError(`Configured POST_URL_TEMPLATE is invalid!

Please reconfigure POST_URL_TEMPLATE to conform to the format specified in ${CONFIG_PATH}.dist.
`);
}

const postTagsKey = process.env.POST_TAGS_KEY || 'tags';

// TODO: Validate remaining config values.

// ---

const app = express();
const formatter = new MicropubFormatter({
  deriveCategory: false, // don't write categories
  layoutName: process.env.POST_LAYOUT_NAME || false,
  noMarkdown: true, // input is already expected to be in Markdown format
});

// Format tags by parsing and reformatting the already-formatted content.
// TODO: This is not ideal since regex replacements may match actual content unintentionally,
// instead of the intended metadata.
// Format using the underlying Micropub document instead?
const formatTags: (formattedContents: string) => string = formattedContents => {
  const spaceDelimitedTagRegex = new RegExp(/^tags: (.*)$/gim);
  const tagMatch = spaceDelimitedTagRegex.exec(formattedContents);
  const hasTags = tagMatch && tagMatch.length === 2;
  let result = formattedContents;

  // If there are no tags, we don't have to do anything.
  if (hasTags) {
    // Replace the post tags key first to prevent trailing whitespace
    // from occurring later if POST_TAG_STYLES.YAML_LIST is used
    result = result.replace(/^tags: ?/gim, `${postTagsKey}: `);

    // Tags are already SPACE_DELIMITED by default from `format-microformat`
    if (postTagsStyle === POST_TAG_STYLES.YAML_LIST) {
      const spaceDelimitedTags = tagMatch[1];
      const tags = spaceDelimitedTags.split(' ');
      const yamlTags = tags.map(tag => `- ${tag}`).join('\n');
      result = formattedContents.replace(spaceDelimitedTagRegex, `${postTagsKey}:\n${yamlTags}`);
    }
  }

  return result;
};

const isMicroblogReply: (properties: { content: string[] }) => boolean = properties => {
  const content = properties.content;
  return content.some(subContent => subContent.match(/^\[@.*\]\(https?:\/\/micro\.blog\/.*\)/));
};

app.use(
  '/micropub',
  micropub({
    tokenReference: {
      me: process.env.INDIEAUTH_IDENTITY,
      endpoint: process.env.INDIEAUTH_TOKEN_ENDPOINT,
    },

    userAgent: 'microstat/1.0.0 (https://github.com/joshdick/microstat)',

    handler: async (micropubDocument /*, req */) => {
      // TODO: Inspect all [0] index references in this handler;
      // process multiple elements instead of just the first element as appropriate?

      const preFormatted = await formatter.preFormat(micropubDocument);

      if (!preFormatted.preFormatted) throw new Error('Received an invalid Micropub request.');

      const type = preFormatted.type[0];

      if (type !== 'h-entry') throw new Error(`Can't handle micropub document type [${type}].`);

      const { properties } = preFormatted;

      const published = properties.published[0];
      const slug = properties.slug[0];

      const suffix = slug ? `_${slug}` : '';
      const postDate = moment(published).format('YYYY/MM/DD_HH.mm.ss');
      const postName = `${postDate}${suffix}`;
      const fileName = `${postName}.md`;
      const postUrl = process.env.POST_URL_TEMPLATE.replace(/\$\{postName\}/i, postName);

      let contents = await formatter.format(preFormatted);
      contents = formatTags(contents);

      const absolutePath = pathResolve(process.env.LOCAL_POSTS_DIR, fileName);
      await mkdirp(pathDirname(absolutePath));
      await writeFileAsync(absolutePath, contents);

      try {
        log.log('Publishing post...');
        execSync(process.env.PUBLISH_COMMAND.replace(' ', '\\ '), {
          cwd: pathDirname(process.env.PUBLISH_COMMAND),
        });
      } catch (publishError) {
        log.error('Error publishing post!', publishError);

        try {
          // Attempt to clean up the unpublished post to prevent duplicate posts
          // from being published if reattempts are made
          log.log('Cleaning up unpublished post...');
          await unlinkAsync(absolutePath);
          log.log('Done cleaning up.');
        } catch (cleanupError) {
          log.error("Couldn't clean up unpublished post!", cleanupError);
        }

        // Rethrow fatally
        throw publishError;
      }

      const replyUrls = properties['in-reply-to'];
      if (replyUrls) {
        for (const replyUrl of replyUrls) {
          log.log(`Post is a reply to [${replyUrl}]; will attempt to send Webmention.`);
          try {
            if (isMicroblogReply(properties)) {
              log.log('Reply is targeted at a micro.blog user, using micro.blog Webmention endpoint.');
              await axios.post(
                'https://micro.blog/webmention',
                // `source` is our post; `target` is the URL being replied to
                querystring.stringify({
                  source: postUrl,
                  target: replyUrl,
                }),
                {
                  headers: {
                    'content-type': 'application/x-www-form-urlencoded',
                  },
                }
              );
            } else {
              log.log('Reply is not targeted at a micro.blog user, auto-discovering Webmention endpoint.');
              await new Promise((resolve, reject) => {
                webmention(
                  {
                    source: postUrl,
                    target: replyUrl,
                  },
                  (err, obj) => {
                    if (err) {
                      reject(err); // should be logged in the `catch` block below
                    }
                    if (!obj.success) reject(obj);
                    resolve(obj);
                  }
                );
              });
            }
            log.log(`Successfully sent Webmention: [${postUrl} -> ${replyUrl}]`);
          } catch (webmentionError) {
            log.error("Couldn't send Webmention!", webmentionError);
            log.error('Continuing nonfatally...');
          }
        }
      }

      if (process.env.MICROBLOG_PING_FEED_URL && !replyUrls) {
        try {
          log.log(`Attempting to ping micro.blog with feed URL [${process.env.MICROBLOG_PING_FEED_URL}]...`);
          await axios.post(
            'https://micro.blog/ping',
            querystring.stringify({
              url: process.env.MICROBLOG_PING_FEED_URL,
            }),
            {
              headers: {
                'content-type': 'application/x-www-form-urlencoded',
              },
            }
          );
          log.log('Successfully pinged micro.blog.');
        } catch (pingError) {
          log.error("Couldn't ping micro.blog!", pingError);
          log.error('Continuing nonfatally...');
        }
      }

      return { url: postUrl };
    },
  })
);

app.listen(process.env.LISTEN_PORT, () => log.log(`Listening on port ${process.env.LISTEN_PORT}.`));
