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
  `,
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

  private validateFunction(param: string): void {
    if (typeof this.config.get(param) !== 'function') {
      this.handleFatalError(`Configured \`${param}\` must be a function!`);
    }
  }

  private validateString(param: string): void {
    if (typeof this.config.get(param) !== 'string') {
      this.handleFatalError(`Configured \`${param}\` must be a string!`);
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
    this.validateFunction('posts.generators.url');

    // posts.generators.filename
    this.validateFunction('posts.generators.filename');

    // posts.layoutName
    this.validateString('posts.layoutName');

    // posts.tags.key
    this.validateString('posts.tags.key');

    // posts.tags.style
    const configuredPostTagStyle = this.config.get('posts.tags.style').toLocaleUpperCase();
    if (!POST_TAG_STYLES[configuredPostTagStyle]) {
      this.handleFatalError(`Configured \`posts.tags.style\` is invalid!

Please reconfigure \`posts.tags.style\` to be one of the values specified in \`dist.js\`.`);
    }
  }

  private validateMediaConfig(): void {
    // media.generators.filenamePrefix
    this.validateFunction('media.generators.filenamePrefix');
    try {
      const generatePrefix = this.config.get('media.generators.filenamePrefix');
      const result = generatePrefix(new Date().getTime(), 'dummy-slug');
      if (typeof result !== 'string') {
        // Just trigger the `catch` block below;
        // it could also be triggered if the generator itself throws an error.
        throw new Error('Wrong output type!');
      }
    } catch (error) {
      this.handleFatalError(
        `Configured \`media.generators.filenamePrefix\` must be a function that generates a string!`,
      );
    }

    // media.generators.filenameSuffix
    this.validateFunction('media.generators.filenameSuffix');
    try {
      const generateSuffix = this.config.get('media.generators.filenameSuffix');
      const result = generateSuffix();
      // The following checks just trigger the `catch` block below;
      // it could also be triggered if the generator itself throws an error.
      if (typeof result !== 'string') {
        throw new Error('Wrong output type!');
      } else if (!result.match(/:filesslug/)) {
        throw new Error('Did not contain `:filesslug`!');
      }
    } catch (error) {
      this.handleFatalError(
        `Configured \`media.generators.filenameSuffix\` must be a function that generates a string that contains the substring \`:filesslug\`!`,
      );
    }
  }

  // Validate configuration.
  public validate(): void {
    this.validateAppConfig();
    this.validateSiteConfig();
    this.validatePostsConfig();
    this.validateMediaConfig();
  }
}
