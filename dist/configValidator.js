"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = require("path");
const fs_1 = require("fs");
const url_1 = require("url");
const constants_1 = require("./constants");
class ConfigValidator {
    constructor(log) {
        this.log = log;
        // `..` will either be the 'src' or 'dist' folder depending on how microstat is started.
        const CONFIG_DIRECTORY_PATH = path_1.resolve(path_1.dirname(__filename), '../config');
        const LOCAL_CONFIG_PATH = path_1.resolve(CONFIG_DIRECTORY_PATH, 'local.js');
        if (!fs_1.existsSync(LOCAL_CONFIG_PATH)) {
            this.handleFatalError(`Couldn't read configuration!
  Please copy ${CONFIG_DIRECTORY_PATH}/dist.js to ${LOCAL_CONFIG_PATH}
  and modify the values as described in the comments.
  `);
        }
        // Load after explicitly validating presence of the config file above,
        // so our custom error message above will take precedence over `config`'s
        const config = require('config'); // eslint-disable-line @typescript-eslint/no-var-requires
        this.config = config;
    }
    handleFatalError(error) {
        this.log.error(error);
        process.exit(1);
    }
    validateURL(param, optional = false) {
        const urlError = `Configured \`${param}\` must be a valid URL!`;
        if (this.config.has(param)) {
            const url = this.config.get(param);
            if (optional && !url)
                return; // Allow empty string
            try {
                new url_1.URL(url); // use constructor for validation as a side effect
            }
            catch (e) {
                this.handleFatalError(urlError);
            }
        }
        else {
            if (!optional) {
                this.handleFatalError(urlError);
            }
        }
    }
    validatePath(param) {
        if (!fs_1.existsSync(this.config.get(param))) {
            this.handleFatalError(`Configured \`${param}\` must exist in the filesystem!`);
        }
    }
    validateFunction(param) {
        if (typeof this.config.get(param) !== 'function') {
            this.handleFatalError(`Configured \`${param}\` must be a function!`);
        }
    }
    validateString(param) {
        if (typeof this.config.get(param) !== 'string') {
            this.handleFatalError(`Configured \`${param}\` must be a string!`);
        }
    }
    validateAppConfig() {
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
    validateSiteConfig() {
        // site.indieauth.identity
        this.validateURL('site.indieauth.identity');
        // site.indieauth.tokenEndpoint
        this.validateURL('site.indieauth.tokenEndpoint');
        // site.root
        this.validatePath('site.root');
    }
    validatePostsConfig() {
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
        if (!constants_1.POST_TAG_STYLES[configuredPostTagStyle]) {
            this.handleFatalError(`Configured \`posts.tags.style\` is invalid!

Please reconfigure \`posts.tags.style\` to be one of the values specified in \`dist.js\`.`);
        }
    }
    validateMediaConfig() {
        // TODO: Implement
    }
    // Validate configuration.
    validate() {
        this.validateAppConfig();
        this.validateSiteConfig();
        this.validatePostsConfig();
        this.validateMediaConfig();
    }
}
exports.default = ConfigValidator;
//# sourceMappingURL=configValidator.js.map