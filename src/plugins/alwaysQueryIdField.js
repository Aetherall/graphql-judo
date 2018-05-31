import { parse } from 'graphql'
import { extractFragmentReplacements } from 'prisma-binding';

function addFragment(schemaAST, fragmentSelection) {
  return schemaAST.definitions.reduce((result, schemaDefinition) => {
      if (schemaDefinition.kind === 'ObjectTypeDefinition') {
          return {
              ...result,
              [schemaDefinition.name.value]: schemaDefinition.fields.reduce((result, fieldDefinition) => {
                  //TODO this includes check is naive and will break for some strings
                  if (fragmentSelection.includes(fieldDefinition.name.value)) {
                      return result;
                  }

                  return {
                      ...result,
                      [fieldDefinition.name.value]: {
                          fragment: `fragment Fragment on ${schemaDefinition.name.value} ${fragmentSelection}`,
                          resolve: (parent, args, context, info) => {
                              return parent[fieldDefinition.name.value];
                          }
                      }
                  };
              }, {})
          };
      }
      else {
          return result;
      }
  }, {});
}



export default (datamodel) => {
  const preparedFieldResolvers = addFragment(parse(datamodel), `{ id }`)
  return { 
    resolvers: preparedFieldResolvers, 
    fragments: extractFragmentReplacements(preparedFieldResolvers)
  }
}