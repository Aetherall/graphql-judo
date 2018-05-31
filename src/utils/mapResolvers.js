
const defaultMiddleware = (resolve, parent, args, context, info) => resolve(args, info)

export default (middleware = defaultMiddleware, resolvers) => {
  return Object.entries(resolvers).reduce((result, entry) => {
          const resolverName = entry[0];
          const resolve = entry[1];
          return {
              ...result,
              [resolverName]: async (parent, args, context, info) => {
                return middleware(resolve, parent, args, context, info)
              }
          };
  }, {})
}