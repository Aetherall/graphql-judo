'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var graphql = require('graphql');
var express = _interopDefault(require('express'));
var apolloServerExpress = require('apollo-server-express');
var bodyParserGraphql = require('body-parser-graphql');
var expressPlayground = _interopDefault(require('graphql-playground-middleware-express'));
var subscriptionsTransportWs = require('subscriptions-transport-ws');
var prismaBinding = require('prisma-binding');
var graphqlTools = require('graphql-tools');
var mergeGraphqlSchemas = require('merge-graphql-schemas');

function _defineProperty(obj, key, value) {
  if (key in obj) {
    Object.defineProperty(obj, key, {
      value: value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  } else {
    obj[key] = value;
  }

  return obj;
}

function _objectSpread(target) {
  for (var i = 1; i < arguments.length; i++) {
    var source = arguments[i] != null ? arguments[i] : {};
    var ownKeys = Object.keys(source);

    if (typeof Object.getOwnPropertySymbols === 'function') {
      ownKeys = ownKeys.concat(Object.getOwnPropertySymbols(source).filter(function (sym) {
        return Object.getOwnPropertyDescriptor(source, sym).enumerable;
      }));
    }

    ownKeys.forEach(function (key) {
      _defineProperty(target, key, source[key]);
    });
  }

  return target;
}

function defaultErrorFormatter(error) {
  const data = graphql.formatError(error);

  if (error.originalError && error.originalError.result && error.originalError.result.errors && error.originalError.result.errors.length === 1) {
    const originalError = error.originalError.result.errors[0];

    if (originalError.message === error.message) {
      if (originalError.code) {
        data.code = originalError.code;
      }

      if (originalError.requestId) {
        data.requestId = originalError.requestId;
      }
    }
  }

  return data;
}

const defaultMiddleware = (resolve, parent, args, context, info) => resolve(args, info);

var mapResolvers = ((middleware = defaultMiddleware, resolvers) => {
  return Object.entries(resolvers).reduce((result, entry) => {
    const resolverName = entry[0];
    const resolve = entry[1];
    return _objectSpread({}, result, {
      [resolverName]: async (parent, args, context, info) => {
        return middleware(resolve, parent, args, context, info);
      }
    });
  }, {});
});

var mapSubscriptions = ((middleware, subscriptions) => {
  return Object.entries(subscriptions).reduce((result, entry) => {
    const resolverName = entry[0];
    const resolve = entry[1];
    return _objectSpread({}, result, {
      [resolverName]: {
        subscribe: (parent, args, ctx, info) => {
          return ctx.db.subscription[resolverName](args, info);
        }
      }
    });
  }, {});
});

const defaultConfig = {
  endpoint: '/graphql',
  playground: '/playground',
  prisma: {
    url: 'http://localhost:4466',
    debug: true
  }
};

class Judo {
  constructor(_config) {
    _defineProperty(this, "init", config => {
      this.config = config;
      this.initPrisma();
      this.prepareSchema();
      this.startHttpServer();
      this.startWsServer();
      return this;
    });

    _defineProperty(this, "initPrisma", () => {
      this.prisma = new prismaBinding.Prisma({
        typeDefs: this.config.graphqlFiles.prisma,
        endpoint: this.config.prisma.url,
        // the endpoint of the Prisma DB service
        secret: this.config.prisma.secret,
        // specified in database/prisma.yml //TODO obviously this should be controlled with environment variables
        debug: this.config.prisma.debug,
        // log all GraphQL queries & mutations
        fragmentReplacements: this.config.fragments
      });
    });

    _defineProperty(this, "prepareSchema", () => {
      const mappedResolvers = {
        Query: mapResolvers(this.config.queryMiddleware, this.prisma.query),
        Mutation: mapResolvers(this.config.mutationMiddleware, this.prisma.mutation),
        Subscription: mapSubscriptions(this.config.subscriptionMiddleware, this.prisma.subscription)
      };
      const resolvers = this.mergeResolvers(mappedResolvers);
      const typeDefs = this.mergeTypeDefs();
      this.schema = graphqlTools.makeExecutableSchema({
        typeDefs,
        resolvers,
        directiveResolvers: this.config.directiveResolvers,
        resolverValidationOptions: {
          requireResolversForResolveType: false
        }
      });
    });

    _defineProperty(this, "mergeResolvers", mappedResolvers => {
      if (!this.config.resolvers) {
        return mappedResolvers;
      }

      if (this.config.resolvers instanceof Array) {
        return mergeGraphqlSchemas.mergeResolvers([mappedResolvers, ...this.config.resolvers]);
      }

      return mergeGraphqlSchemas.mergeResolvers([mappedResolvers, this.config.resolvers]);
    });

    _defineProperty(this, "mergeTypeDefs", () => {
      return mergeGraphqlSchemas.mergeTypes([this.config.graphqlFiles.datamodel, this.config.graphqlFiles.prisma, ...(this.config.graphqlFiles.typeDefs || [])], {
        all: true,
        override: true
      });
    });

    _defineProperty(this, "startHttpServer", () => {
      this.express = express();
      this.express.post(this.config.endpoint, bodyParserGraphql.bodyParserGraphQL()); //this.express.post(this.config.endpoint, apolloUploadExpress(this.config.uploads))

      this.express.post(this.config.endpoint, apolloServerExpress.graphqlExpress(this.middleware));
      this.express.get(this.config.playground, expressPlayground({
        endpoint: this.config.endpoint,
        subscriptionsEndpoint: this.config.endpoint
      }));
    });

    _defineProperty(this, "middleware", async (request, response) => {
      const context = typeof this.context === 'function' ? await this.context({
        request,
        response
      }) : this.context;
      return {
        schema: this.schema,
        context: _objectSpread({}, context || {}, {
          db: this.prisma
        })
      };
    });

    _defineProperty(this, "startWsServer", () => {
      if (this.config.server.ws) {
        this.config.server.ws.closeHandler();
        delete this.config.server.ws;
      }

      this.config.server.ws = new subscriptionsTransportWs.SubscriptionServer({
        schema: this.schema,
        execute: graphql.execute,
        subscribe: graphql.subscribe,
        onConnect: (connectionParams, webSocket) => _objectSpread({}, connectionParams),
        onOperation: async (message, connection, webSocket) => {
          connection.formatResponse = value => _objectSpread({}, value, {
            errors: value.errors && value.errors.map(defaultErrorFormatter)
          });

          const context = typeof this.config.context === 'function' ? await this.config.context({
            connection
          }) : this.config.context;
          return _objectSpread({}, connection, {
            context: _objectSpread({}, context || {}, {
              db: this.prisma
            })
          });
        }
      }, {
        server: this.config.server,
        path: this.config.endpoint
      });
    });

    const conf = _objectSpread({}, defaultConfig, _config, {
      prisma: _objectSpread({}, defaultConfig.prisma, _config.prisma || {})
    });

    if (_config.server.judo) return _config.server.judo.init(conf);
    this.init(conf);
  }

}

function addFragment(schemaAST, fragmentSelection) {
  return schemaAST.definitions.reduce((result, schemaDefinition) => {
    if (schemaDefinition.kind === 'ObjectTypeDefinition') {
      return _objectSpread({}, result, {
        [schemaDefinition.name.value]: schemaDefinition.fields.reduce((result, fieldDefinition) => {
          //TODO this includes check is naive and will break for some strings
          if (fragmentSelection.includes(fieldDefinition.name.value)) {
            return result;
          }

          return _objectSpread({}, result, {
            [fieldDefinition.name.value]: {
              fragment: `fragment Fragment on ${schemaDefinition.name.value} ${fragmentSelection}`,
              resolve: (parent, args, context, info) => {
                return parent[fieldDefinition.name.value];
              }
            }
          });
        }, {})
      });
    } else {
      return result;
    }
  }, {});
}

var alwaysQueryIdField = (datamodel => {
  const preparedFieldResolvers = addFragment(graphql.parse(datamodel), `{ id }`);
  return {
    resolvers: preparedFieldResolvers,
    fragments: prismaBinding.extractFragmentReplacements(preparedFieldResolvers)
  };
});

exports.default = Judo;
exports.alwaysQueryIdField = alwaysQueryIdField;
