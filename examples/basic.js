var HelpEsb = require('../help-esb');
var client = new HelpEsb.Client(process.env.ESB_HOST, process.env.ESB_PORT);
client.login('foo');
client.subscribe(['asdf']);

client.on('payload', function(data) {
  console.log('Received data:');
  console.log(data);
});

client.on('error', function(err) {
  console.warn('Oh noes!');
  console.warn(err);
});
