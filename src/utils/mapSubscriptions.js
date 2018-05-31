
const def = (a) => a

export default (middleware, subscriptions) => {
  return Object.entries(subscriptions).reduce((result, entry) => {
          const resolverName = entry[0];
          const resolve = entry[1];
          return {
              ...result,
              [resolverName]: {
                  subscribe: (parent, args, ctx, info) => {
                    return ctx.db.subscription[resolverName](args, info)
                  },
          }
        }
  }, {});
}