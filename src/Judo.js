import express from 'express'
import { graphqlExpress } from 'apollo-server-express'
import { bodyParserGraphQL } from 'body-parser-graphql'
import expressPlayground from 'graphql-playground-middleware-express'
//import { apolloUploadExpress, GraphQLUpload } from 'apollo-upload-server'
import { SubscriptionServer } from 'subscriptions-transport-ws'
import { Prisma } from 'prisma-binding';
import { makeExecutableSchema } from 'graphql-tools'
import { execute, subscribe, parse } from 'graphql'
import { mergeTypes, mergeResolvers } from 'merge-graphql-schemas';

import errorFormatter from './utils/errorFormatter'
import mapResolvers from './utils/mapResolvers'
import mapSubscriptions from './utils/mapSubscriptions'


const defaultConfig = {
  endpoint:'/graphql',
  playground: '/playground',
  prisma: {
    url: 'http://localhost:4466',
    debug: true,
  }
}

export default class Judo {

  constructor(config){
    const conf = {...defaultConfig, ...config, prisma: {...defaultConfig.prisma, ...(config.prisma || {})}}
    if(config.server.judo) return config.server.judo.init(conf)
    this.init(conf)
  }

  init = (config) => {
    this.config = config
    this.initPrisma()
    this.prepareSchema()
    this.startHttpServer()
    this.startWsServer()
    return this
  }

  initPrisma = () => {
    this.prisma = new Prisma({
      typeDefs: this.config.graphqlFiles.prisma,
      endpoint: this.config.prisma.url, // the endpoint of the Prisma DB service
      secret: this.config.prisma.secret, // specified in database/prisma.yml //TODO obviously this should be controlled with environment variables
      debug: this.config.prisma.debug, // log all GraphQL queries & mutations
      fragmentReplacements: this.config.fragments,
    });
  }

  prepareSchema = () => {
    const mappedResolvers = {
      Query: mapResolvers(this.config.queryMiddleware, this.prisma.query),
      Mutation: mapResolvers(this.config.mutationMiddleware, this.prisma.mutation),
      Subscription: mapSubscriptions(this.config.subscriptionMiddleware, this.prisma.subscription)
    }
    const resolvers = this.mergeResolvers(mappedResolvers)

    const typeDefs = this.mergeTypeDefs()

    this.schema = makeExecutableSchema({
      typeDefs,
      resolvers,
      directiveResolvers: this.config.directiveResolvers,
      resolverValidationOptions: {
          requireResolversForResolveType: false
      }
    });

  }

  mergeResolvers = (mappedResolvers) => {
    if(!this.config.resolvers){
      return mappedResolvers
    }
    if(this.config.resolvers instanceof Array){
      return mergeResolvers([mappedResolvers, ...this.config.resolvers])
    }
    return mergeResolvers([mappedResolvers, this.config.resolvers])
  }

  mergeTypeDefs = () => {
    return mergeTypes([
      this.config.graphqlFiles.datamodel,
      this.config.graphqlFiles.prisma,
      ...(this.config.graphqlFiles.typeDefs || []),
    ], {
        all: true,
        override: true
    });
  }

  startHttpServer = () => {
    this.express = express()
    this.express.post(this.config.endpoint, bodyParserGraphQL())
    //this.express.post(this.config.endpoint, apolloUploadExpress(this.config.uploads))
    this.express.post(this.config.endpoint, graphqlExpress(this.middleware))
    this.express.get(this.config.playground, expressPlayground({ 
      endpoint: this.config.endpoint, 
      subscriptionsEndpoint: this.config.endpoint
    }))
  }

  middleware = async (request, response) => {
    const context = typeof this.context === 'function'
      ? await this.context({ request, response })
      : this.context

    return ({
      schema: this.schema,
      context: { ...(context || {}), db: this.prisma }
    })
  }

  startWsServer = () => {
    if (this.config.server.ws) {
      this.config.server.ws.closeHandler()
      delete this.config.server.ws
    }
    this.config.server.ws = new SubscriptionServer({
      schema: this.schema,
      execute,
      subscribe,
      onConnect: (connectionParams, webSocket) => ({ ...connectionParams }),
      onOperation: async (message, connection, webSocket) => {
        connection.formatResponse = value => ({
          ...value,
          errors: value.errors && value.errors.map(errorFormatter),
        })

        const context = typeof this.config.context === 'function'
          ? await this.config.context({ connection })
          : this.config.context

        return { ...connection, context: { ...(context || {}), db: this.prisma } }
      },
      
    },
    {
      server: this.config.server,
      path: this.config.endpoint
    })
  }

}