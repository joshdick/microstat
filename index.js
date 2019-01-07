const child_process = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');

const express = require('express');
const Minilog = require('minilog');
const log = Minilog('microstat');
const MicropubFormatter = require('format-microformat');
const moment = require('moment');
const micropub = require('micropub-express');
const mkdirp = require('mkdirp');
const request = require('request');
const webmention = require('send-webmention');

const mkdirpAsync = util.promisify(mkdirp);
const postAsync = util.promisify(request.post);
const unlinkAsync = util.promisify(fs.unlink);
const writeFileAsync = util.promisify(fs.writeFile);

Minilog.enable();

// Validate configuration.
const CONFIG_PATH = `${__dirname}/config/config`;
if (!fs.existsSync(CONFIG_PATH)) {
	log.error(`Couldn't read configuration!

Please copy ${CONFIG_PATH}.dist to ${CONFIG_PATH}
and modify the values as described in the comments.
`);
	process.exit(1);
}
require('dotenv').config({ path: `${__dirname}/config/config` });

// Ensure that the configured POST_URL_TEMPLATE contains the literal string `${postName}`.
if (!process.env.POST_URL_TEMPLATE.includes('${postName}')) {
	log.error('Configured POST_URL_TEMPLATE is invalid; it must contain the string `${postName}` as part of its value.');
	process.exit(1);
}

const app = express();
const formatter = new MicropubFormatter({
	deriveCategory: false, // don't write categories
	layoutName: 'microblog_post',
	noMarkdown: true // input is already expected to be in Markdown format
});

const isMicroblogReply = (properties) => {
	const content = properties.content;
	return content.some(subContent => subContent.match(/^\[@.*\]\(https?:\/\/micro\.blog\/.*\)/));
};

app.use('/micropub', micropub({

	tokenReference: {
		me: process.env.INDIEAUTH_IDENTITY,
		endpoint: process.env.INDIEAUTH_TOKEN_ENDPOINT
	},

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
		const postUrl = eval('`' + process.env.POST_URL_TEMPLATE + '`');

		const contents = await formatter.format(preFormatted);

		const absolutePath = path.resolve(process.env.LOCAL_POSTS_DIR, fileName);
		await mkdirpAsync(path.dirname(absolutePath));
		await writeFileAsync(absolutePath, contents);

		try {
			log.log('Publishing post...');
			child_process.execSync(process.env.PUBLISH_COMMAND.replace(' ', '\\ '), { cwd: path.dirname(process.env.PUBLISH_COMMAND) });
		} catch (publishError) {
			log.error('Error publishing post!', publishError);

			try {
				// Attempt to clean up the unpublished post to prevent duplicate posts
				// from being published if reattempts are made
				log.log('Cleaning up unpublished post...');
				await unlinkAsync(absolutePath);
				log.log('Done cleaning up.');
			} catch (cleanupError) {
				log.error('Couldn\'t clean up unpublished post!', cleanupError);
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
						await postAsync({
							url: 'https://micro.blog/webmention',
							// `source` is our post; `target` is the URL being replied to
							form: {
								source: postUrl,
								target: replyUrl
							}
						});
					} else {
						log.log('Reply is not targeted at a micro.blog user, auto-discovering Webmention endpoint.');
						await new Promise((resolve, reject) => {
							webmention({
								source: postUrl,
								target: replyUrl
							},
							(err, obj) => {
								if (err) {
									reject(err); // should be logged in the `catch` block below
								}
								if (!obj.success) reject(obj);
								resolve(obj);
							});
						});
					}
					log.log(`Successfully sent Webmention: [${postUrl} -> ${replyUrl}]`);
				} catch (webmentionError) {
					log.error('Couldn\'t send Webmention!', webmentionError);
					log.error('Continuing nonfatally...');
				}
			}
		}

		if (process.env.MICROBLOG_PING_FEED_URL && !replyUrls) {
			try {
				log.log(`Attempting to ping micro.blog with feed URL [${process.env.MICROBLOG_PING_FEED_URL}]...`);
				await postAsync({
					url: 'https://micro.blog/ping',
					body: `url=${process.env.MICROBLOG_PING_FEED_URL}`
				});
				log.log('Successfully pinged micro.blog.');
			} catch (pingError) {
				log.error('Couldn\'t ping micro.blog!', pingError);
				log.error('Continuing nonfatally...');
			}
		}

		return { url: postUrl };
	}

}));

app.listen(process.env.LISTEN_PORT, () => log.log(`Listening on port ${process.env.LISTEN_PORT}.`));
