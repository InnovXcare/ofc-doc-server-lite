const { lambdaHandler } = require("./server/index");

function handler(event, context) {
  return lambdaHandler(event, context);
}

module.exports = { handler };
