# microstat



A self-hosted Micropub endpoint for statically-generated microblogs. 📝⚡️

## What Is This Thing?

microstat lets you publish [Markdown](https://en.wikipedia.org/wiki/Markdown) posts to a statically-generated [microblog](https://en.wikipedia.org/wiki/Microblogging) via [Micropub](https://indieweb.org/Micropub), with automatically-sent [Webmentions](https://indieweb.org/Webmention) and integration with the [micro.blog service](https://micro.blog).

This enables you to post to your static microblog entirely using the web (for example, using a web-based Micropub client like [Quill](https://quill.p3k.io)).

Here's how it works:

- A running microstat server acts as a [Micropub](https://indieweb.org/Micropub) endpoint
- When it receives a Micropub post, it writes a Markdown file to a location you configure
- Once the Markdown file is written, it runs a command you configure (that would trigger something like [Jekyll](https://jekyllrb.com/) or [Hugo](https://gohugo.io/) to build and publish your microblog)
- Once your microblog is updated, it sends a Webmention if your post is a reply to someone else's post
  - Will attempt to automatically discover the Webmention endpoint, or will use [micro.blog](https://micro.blog)'s Webmention endpoint if you're replying to a micro.blog post
- If you use micro.blog, optionally ping micro.blog with your microblog's RSS/Atom/JSON feed so your posts are instantly mirrored there

## Get Going

microstat requires [Node.js](https://nodejs.org) 7.6 or newer. Once you've installed Node.js:

```bash
$ git clone https://github.com/joshdick/microstat.git
$ cd microstat
$ npm install
$ cp config/config.dist config/config
# Edit `config/config` and change the values to fit your site as described by the comments above each value
$ npm start
```

You can manage and start microstat as a [systemd](https://en.wikipedia.org/wiki/Systemd) service or using a tool like [nodemon](https://nodemon.io).

Note that microstat doesn't need to run on the same port, or even the same server, as your microblog. You could directly advertise your microstat server as your site's Micropub endpoint, or you can advertise a proxy to it.

Here's how I proxy to microstat on [my microblog](https://joshdick.net/microblog):

1. Advertise my site's Micropub endpoint by including the following in its HTML:

```html
<link rel="micropub" href="https://joshdick.net/micropub" />
```

2. Configure [nginx](https://nginx.org) to proxy requests sent to the advertised Micropub endpoint to a microstat server that's running on an entirely different machine/port (at `https://example.com:3141`):

```nginx
location /micropub {
	proxy_pass https://example.com:3141;
}
```

## Contributing

Issues and pull requests are welcome! 🙂
