"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const path_1 = require("path");
const querystring = require("querystring");
const util_1 = require("util");
const axios_1 = require("axios");
const express = require("express");
const Minilog = require("minilog");
const MicropubFormatter = require('format-microformat'); // eslint-disable-line @typescript-eslint/no-var-requires
const micropub = require('micropub-express'); // eslint-disable-line @typescript-eslint/no-var-requires
const mkdirp = require("mkdirp");
const webmention = require('send-webmention'); // eslint-disable-line @typescript-eslint/no-var-requires
const configValidator_1 = require("./configValidator");
const constants_1 = require("./constants");
const unlinkAsync = util_1.promisify(fs_1.unlink);
const writeFileAsync = util_1.promisify(fs_1.writeFile);
const log = Minilog('microstat');
Minilog.enable();
// Prevalidate all configuration; this should allow use of 'config.get'
// anywhere else in this file without causing a fatal error
const configValidator = new configValidator_1.default(log);
configValidator.validate();
const config = require('config'); // eslint-disable-line @typescript-eslint/no-var-requires
// ---
const app = express();
const formatter = new MicropubFormatter({
    deriveCategory: false,
    layoutName: config.get('posts.layoutName') || false,
    noMarkdown: true,
});
// Format tags by parsing and reformatting the already-formatted content.
// TODO: This is not ideal since regex replacements may match actual content unintentionally,
// instead of the intended metadata.
// Format using the underlying Micropub document instead?
const postTagsKey = config.get('posts.tags.key');
const postTagsStyle = constants_1.POST_TAG_STYLES[config.get('posts.tags.style').toLocaleUpperCase()];
const formatTags = formattedContents => {
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
        if (postTagsStyle === constants_1.POST_TAG_STYLES.YAML_LIST) {
            const spaceDelimitedTags = tagMatch[1];
            const tags = spaceDelimitedTags.split(' ');
            const yamlTags = tags.map(tag => `- ${tag}`).join('\n');
            result = formattedContents.replace(spaceDelimitedTagRegex, `${postTagsKey}:\n${yamlTags}`);
        }
    }
    return result;
};
const isMicroblogReply = properties => {
    const content = properties.content;
    return content.some(subContent => subContent.match(/^\[@.*\]\(https?:\/\/micro\.blog\/.*\)/));
};
const microblogPingFeedURL = config.has('app.microblogPingFeedURL') && config.get('app.microblogPingFeedURL');
const postFilenameGenerator = config.get('posts.generators.filename');
const postUrlGenerator = config.get('posts.generators.url');
const publishCommand = config.get('app.publishCommand');
const siteRoot = config.get('site.root');
app.use('/micropub', micropub({
    tokenReference: {
        me: config.get('site.indieauth.identity'),
        endpoint: config.get('site.indieauth.tokenEndpoint'),
    },
    userAgent: 'microstat/1.0.0 (https://github.com/joshdick/microstat)',
    handler: async (micropubDocument /*, req */) => {
        // TODO: Inspect all [0] index references in this handler;
        // process multiple elements instead of just the first element as appropriate?
        const preFormatted = await formatter.preFormat(micropubDocument);
        if (!preFormatted.preFormatted)
            throw new Error('Received an invalid Micropub request.');
        const type = preFormatted.type[0];
        if (type !== 'h-entry')
            throw new Error(`Can't handle micropub document type [${type}].`);
        const { properties } = preFormatted;
        const published = properties.published[0];
        const slug = properties.slug[0];
        const fileName = postFilenameGenerator(published, slug);
        const postUrl = postUrlGenerator(published, slug);
        let contents = await formatter.format(preFormatted);
        contents = formatTags(contents);
        const absolutePath = path_1.resolve(siteRoot, fileName);
        await mkdirp(path_1.dirname(absolutePath));
        await writeFileAsync(absolutePath, contents);
        try {
            log.log('Publishing post...');
            child_process_1.execSync(publishCommand.replace(' ', '\\ '), {
                cwd: path_1.dirname(publishCommand),
            });
        }
        catch (publishError) {
            log.error('Error publishing post!', publishError);
            try {
                // Attempt to clean up the unpublished post to prevent duplicate posts
                // from being published if reattempts are made
                log.log('Cleaning up unpublished post...');
                await unlinkAsync(absolutePath);
                log.log('Done cleaning up.');
            }
            catch (cleanupError) {
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
                        await axios_1.default.post('https://micro.blog/webmention', 
                        // `source` is our post; `target` is the URL being replied to
                        querystring.stringify({
                            source: postUrl,
                            target: replyUrl,
                        }), {
                            headers: {
                                'content-type': 'application/x-www-form-urlencoded',
                            },
                        });
                    }
                    else {
                        log.log('Reply is not targeted at a micro.blog user, auto-discovering Webmention endpoint.');
                        await new Promise((resolve, reject) => {
                            webmention({
                                source: postUrl,
                                target: replyUrl,
                            }, (err, obj) => {
                                if (err) {
                                    reject(err); // should be logged in the `catch` block below
                                }
                                if (!obj.success)
                                    reject(obj);
                                resolve(obj);
                            });
                        });
                    }
                    log.log(`Successfully sent Webmention: [${postUrl} -> ${replyUrl}]`);
                }
                catch (webmentionError) {
                    log.error("Couldn't send Webmention!", webmentionError);
                    log.error('Continuing nonfatally...');
                }
            }
        }
        if (microblogPingFeedURL && !replyUrls) {
            try {
                log.log(`Attempting to ping micro.blog with feed URL [${microblogPingFeedURL}]...`);
                await axios_1.default.post('https://micro.blog/ping', querystring.stringify({
                    url: microblogPingFeedURL,
                }), {
                    headers: {
                        'content-type': 'application/x-www-form-urlencoded',
                    },
                });
                log.log('Successfully pinged micro.blog.');
            }
            catch (pingError) {
                log.error("Couldn't ping micro.blog!", pingError);
                log.error('Continuing nonfatally...');
            }
        }
        return { url: postUrl };
    },
}));
const listenPort = config.get('app.listenPort');
app.listen(listenPort, () => log.log(`Listening on port ${listenPort}.`));
//# sourceMappingURL=microstat.js.map