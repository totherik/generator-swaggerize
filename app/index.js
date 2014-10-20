'use strict';

var util = require('util'),
    path = require('path'),
	fs = require('fs'),
    yeoman = require('yeoman-generator'),
    apischema = require('swaggerize-builder/lib/schema/swagger-spec/schemas/v2.0/schema.json'),
    builderUtils = require('swaggerize-builder/lib/utils'),
    enjoi = require('enjoi'),
    chalk = require('chalk');

var ModuleGenerator = yeoman.generators.Base.extend({
    init: function () {
        this.pkg = yeoman.file.readJSON(path.join(__dirname, '../package.json'));

        this.on('end', function () {
            if (!this.options['skip-install']) {
                this.npmInstall();
            }
        });
    },

    askFor: function () {
        var done = this.async();

        // have Yeoman greet the user
        console.log(chalk.magenta('Swaggerize Generator'));

        var prompts = [
            {
                name: 'appname',
                message: 'What would you like to call this project:',
                default : this.appname
            },
            {
                name: 'creatorName',
                message: 'Your name:'
            },
            {
                name: 'githubUser',
                message: 'Your github user name:'
            },
            {
                name: 'email',
                message: 'Your email:'
            },
            {
                name: 'apiPath',
                message: 'Path to swagger document:'
            },
            {
                name: 'framework',
                message: 'Express or Hapi:',
                default: 'express'
            }
        ];

        this.prompt(prompts, function (props) {
            this.appname = props.appname;
            this.creatorName = props.creatorName;
            this.githubUser = props.githubUser;
            this.email = props.email;
            this.framework = props.framework || 'express';

            try {
				this.apiPath = path.resolve(props.apiPath);
			}
			catch (error) {
				done(error);
				return;
			}

			done();
        }.bind(this));
    },

    root: function () {
        this.appRoot = path.join(this.destinationRoot(), this.appname);

        if (process.cwd() !== this.appRoot) {

            this.mkdir(this.appRoot);

            process.chdir(this.appRoot);
        }
    },

    validate: function () {
        var done = this.async();

        if (this.framework !== 'express' && this.framework !== 'hapi') {
            done(new Error('Framework must be hapi or express'));
            return;
        }

        this.api = yeoman.file.readJSON(this.apiPath);

        enjoi(apischema).validate(this.api, function (error) {
            done(error);
        });
    },

    app: function () {
        this.mkdir('config');
        this.copy(this.apiPath, 'config/' + path.basename(this.apiPath));

        this.copy('jshintrc', '.jshintrc');
        this.copy('gitignore', '.gitignore');
        this.copy('npmignore', '.npmignore');
        this.copy('index_' + this.framework + '.js', 'index.js');

        this.template('_package.json', 'package.json');
        this.template('_README.md', 'README.md');
    },

    handlers: function () {
        var routes, self;

        self = this;
        routes = {};

        this.mkdir('handlers');

        Object.keys(this.api.paths).forEach(function (path) {
            var pathnames, route;

            route = {
                path: path,
                pathname: undefined,
                methods: []
            };

            pathnames = [];

            path.split('/').forEach(function (element) {
                if (element) {
                    pathnames.push(element);
                }
            });

            route.pathname = pathnames.join('/');

            builderUtils.verbs.forEach(function (verb) {
                var operation = self.api.paths[path][verb];

                if (!operation) {
                    return;
                }

                route.methods.push({
                    method: verb,
                    name: operation.operationId || '',
                    description: operation.description || '',
                    parameters: operation.parameters || [],
                    produces: operation.produces || []
                });
            });

            if (routes[route.pathname]) {
                routes[route.pathname].methods.push.apply(routes[route.pathname].methods, route.methods);
                return;
            }

            routes[route.pathname] = route;
        });

        Object.keys(routes).forEach(function (routePath) {
            var pathnames, route, file;

            route = routes[routePath];
            pathnames = route.pathname.split('/');

            file = path.join(self.appRoot, 'handlers/' + pathnames.join('/') + '.js');

            self.template('_handler_' + self.framework + '.js', file, route);
        });
    },

    models: function () {
        var self = this;

        this.mkdir('models');

        Object.keys(this.api.definitions || {}).forEach(function (modelName) {
            var fileName, model;

            fileName = modelName.toLowerCase() + '.js';

            model = self.api.definitions[modelName];

            if (!model.id) {
                model.id = modelName;
            }

            self.template('_model.js', path.join(self.appRoot, 'models/' + fileName), model);
        });
    },

    tests: function () {
        var self, api, models, resourcePath, handlersPath, modelsPath, apiPath;

        this.mkdir('tests');

        self = this;
        api = this.api;
        models = {};

        apiPath = path.relative(path.join(self.appRoot, 'tests'), path.join(self.appRoot, 'config/' + path.basename(this.apiPath)));
        modelsPath = path.join(self.appRoot, 'models');
        handlersPath = path.relative(path.join(self.appRoot, 'tests'), path.join(self.appRoot, 'handlers'));

        if (api.definitions && modelsPath) {

            Object.keys(api.definitions).forEach(function (key) {
                var modelSchema, ModelCtor, options;

                options = {};
                modelSchema = api.definitions[key];
                ModelCtor = require(path.join(self.appRoot, 'models/' + key.toLowerCase() + '.js'));

                Object.keys(modelSchema.properties).forEach(function (prop) {
                    var defaultValue;

                    switch (modelSchema.properties[prop].type) {
                        case 'integer':
                        case 'number':
                        case 'byte':
                            defaultValue = 1;
                            break;
                        case 'string':
                            defaultValue = 'helloworld';
                            break;
                        case 'boolean':
                            defaultValue = true;
                            break;
                        default:
                            break;
                    }

                    if (!!~modelSchema.required.indexOf(prop)) {
                        options[prop] = defaultValue;
                    }
                });

                models[key] = new ModelCtor(options);
            });

        }

        resourcePath = api.basePath;

        Object.keys(api.paths).forEach(function (opath) {
            var fileName, operations;

            operations = [];

            builderUtils.verbs.forEach(function (verb) {
                var operation = {};

                if (!api.paths[opath][verb]) {
                    return;
                }

                Object.keys(api.paths[opath][verb]).forEach(function (key) {
                    operation[key] = api.paths[opath][verb][key];
                });

                operation.path = opath;
                operation.method = verb;

                operations.push(operation);
            });

            fileName = path.join(self.appRoot, 'tests/test' + opath.replace(/\//g, '_') + '.js');

            self.template('_test_' + self.framework + '.js', fileName, {
                apiPath: apiPath,
                handlers: handlersPath,
                resourcePath: resourcePath,
                operations: operations,
                models: models
            });

        });
    }

});

module.exports = ModuleGenerator;
