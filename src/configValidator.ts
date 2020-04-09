import { dirname as pathDirname, resolve as pathResolve } from 'path';
import { existsSync } from 'fs';
import { URL } from 'url';

import { POST_TAG_STYLES } from './constants';

export default class ConfigValidator {
  private readonly log: Minilog;
  private readonly config;

  constructor(log: Minilog) {
    this.log = log;

    // `..` will either be the 'src' or 'dist' folder depending on how microstat is started.
    const CONFIG_DIRECTORY_PATH = pathResolve(pathDirname(__filename), '../config');
    const LOCAL_CONFIG_PATH = pathResolve(CONFIG_DIRECTORY_PATH, 'local.js');
    if (!existsSync(LOCAL_CONFIG_PATH)) {
      this.handleFatalError(
        `Couldn't read configuration!
  Please copy ${CONFIG_DIRECTORY_PATH}/dist.js to ${LOCAL_CONFIG_PATH}
  and modify the values as described in the comments.
  `
      );
    }

    // Load after explicitly validating presence of the config file above,
    // so our custom error message above will take precedence over `config`'s
    const config = require('config'); // eslint-disable-line @typescript-eslint/no-var-requires
    this.config = config;
  }

  private handleFatalError(error: string): void {
    this.log.error(error);
    process.exit(1);
  }

  private validateURL(param: string, optional = false): void {
    const urlError = `Configured \`${param}\` must be a valid URL!`;
    if (this.config.has(param)) {
      const url = this.config.get(param);
      if (optional && !url) return; // Allow empty string
      try {
        new URL(url); // use constructor for validation as a side effect
      } catch (e) {
        this.handleFatalError(urlError);
      }
    } else {
      if (!optional) {
        this.handleFatalError(urlError);
      }
    }
  }

  private validatePath(param: string): void {
    if (!existsSync(this.config.get(param))) {
      this.handleFatalError(`Configured \`${param}\` must exist in the filesystem!`);
    }
  }

  private validateAppConfig(): void {
    // app.listenPort
    const portError = 'Configured `app.listenPort` must be a number between 1 and 65535!';
    const listenPort = this.config.get('app.listenPort');
    if (typeof listenPort !== 'number') {
      this.handleFatalError(portError);
    }
    const parsedListenPort = parseInt(listenPort, 10);
    if (parsedListenPort < 1 || parsedListenPort > 65535) {
      this.handleFatalError(portError);
    }

    // app.microblogPingFeedURL
    this.validateURL('app.microblogPingFeedURL', true);

    // app.publishCommand
    this.validatePath('app.publishCommand');
  }

  private validateSiteConfig(): void {
    // site.indieauth.identity
    this.validateURL('site.indieauth.identity');

    // site.indieauth.tokenEndpoint
    this.validateURL('site.indieauth.tokenEndpoint');

    // site.root
    this.validatePath('site.root');
  }

  private validatePostsConfig(): void {
    // posts.generators.url
    // TODO: Implement
    // posts.generators.filename
    // TODO: Implement
    // posts.layoutName
    // TODO: Implement

    // posts.tags.key
    if (typeof this.config.get('posts.tags.key') !== 'string') {
      this.handleFatalError('Configured `posts.tags.key` must be a string!');
    }

    // posts.tags.style
    const configuredPostTagStyle = this.config.get('posts.tags.style').toLocaleUpperCase();
    if (!POST_TAG_STYLES[configuredPostTagStyle]) {
      this.handleFatalError(`Configured POST_TAG_STYLE is invalid!

Please reconfigure POST_TAG_STYLE to be one of the values specified in \`dist.js\`.`);
    }
  }

  private validateMediaConfig(): void {
    // TODO: Implement
  }

  // Validate configuration.
  public validate(): void {
    this.validateAppConfig();
    this.validateSiteConfig();
    this.validatePostsConfig();
    this.validateMediaConfig();
  }
}
