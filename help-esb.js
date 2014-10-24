//     help-esb.js

(function(root, factory) {
  'use strict';

  // Setup HelpEsb appropriately for the environment.  Dependency on net likely
  // means this only works on Node.js, but meh.
  if (typeof define === 'function' && define.amd) {
    define(['net', 'bluebird'], function(net, Promise) {
      root.HelpEsb = factory(exports, net, Promise);
    });
  } else if (typeof exports !== 'undefined') {
    factory(exports, require('net'), require('bluebird'));
  } else {
    root.HelpEsb = factory({}, root.net, root.Promise);
  }
}(this, function(HelpEsb, net, Promise) {
  'use strict';

  // ## HelpEsb.Client

  // The client connects to the ESB running on the given host/port.  You will
  // need to **subscribe** before doing anything over the connection.
  //
  //     var client = Esb.Client('example.com', 1234);
  //     client.subscribe('clientName', ['subscriptionChannel1']);
  HelpEsb.Client = function(host, port) {
    // This uses the basic socket connection to the ESB.  We are forcing utf-8
    // here as we shouldn't really use anything else.
    this._socket = net.createConnection({host: host, port: port});
    this._socket.setEncoding('utf-8');

    // We can't send anything over the socket until we have a connection.  We
    // immediately initiate the connection and save a promise for it so that
    // the client ensures the connection exists before trying to send data.
    var promiseOn = Promise.promisify(this._socket.on, this._socket);
    this._socketConnection = promiseOn('connect');

    // Handle data coming in over the socket using our special handler.
    // Because data can come in pieces, we have to keep a data buffer so that
    // we only process complete payloads.
    this._buffer = '';
    this._socket.on('data', this._handleData.bind(this));

    // Error handling is a bit simpler - we can just pass the error to the
    // user's configured error handler.
    this._socket.on('error', this._trigger.bind(this, 'error'));

    // We begin with empty handlers.
    this._handlers = {};
  };

  // Register with the ESB and list your desired channel subscriptions.  This
  // returns a [promise](https://github.com/petkaantonov/bluebird) of the send
  // event so you can do additional tasks after the subscription has been sent.
  // Note that this currently only checks that the message was sent and so the
  // promise does not indicate that the subscription was successful on the ESB.
  //
  //     client.subscribe('test', ['a', 'b']).then(function() {
  //       console.log('Subscribed!');
  //     });
  HelpEsb.Client.prototype.subscribe = function(name, subscriptions) {
    return this._send({
      meta: {type: 'subscribe'},
      data: {name: name, subscriptions: subscriptions}
    });
  };

  // Register an event handler for the given event.  This may be called
  // multiple times to attach multiple event handlers for the same event or for
  // different ones.  They will be called in the order they are added.  The
  // events sent include: `payload`, and `error`.
  //
  //     client.on('payload', function(data) {
  //       console.log(data);
  //     });
  //     client.on('error', function(error) {
  //       console.warn(error);
  //     });
  HelpEsb.Client.prototype.on = function(name, cb) {
    // Lazily initialize the handlers
    if (typeof this._handlers[name] === 'undefined') {
      this._handlers[name] = [];
    }

    this._handlers[name].push(cb);
  };

  // Sends a payload message to the ESB with the given data.  Returns a promise
  // that,, like the `subscribe` call, is fulfilled when the message is sent,
  // but does not indicate whether the message was received by the ESB.
  //
  //     client.send({id: 1234, message: 'Hello!'});
  HelpEsb.Client.prototype.send = function(data) {
    return this._send({meta: {type: 'payload'}, data: data});
  };

  // ### Private

  // Wait on the socket connection and once it is available, send the JSON
  // serialized packet.  Each message must be terminated with a newline.
  HelpEsb.Client.prototype._send = function(packet) {
    return this._socketConnection.then(function() {
      this._socket.write(JSON.stringify(packet) + '\n');
    }.bind(this));
  };

  // Handle an incoming slice of data over the socket.  Split the message on
  // the newline delimiters and pass each complete packet to `_handlePacket`.
  HelpEsb.Client.prototype._handleData = function(data) {
    // Continue to append to the buffer.  The full message may not come in one
    // piece.
    this._buffer += data;
    if (this._buffer.indexOf('\n') !== -1) {
      // It is even possible that multiple packets were sent at once and so we
      // need to make sure we parse all of them.
      var packets = this._buffer.split('\n');

      // The section after the last newline (which may be empty) is kept in the
      // buffer as it belongs to the next packet.
      this._buffer = packets[packets.length - 1];

      packets.slice(0, -1).forEach(this._handlePacket.bind(this));
    }
  };

  // Handles a single packet of data.  The data is expected to be JSON, and if
  // it isn't, an error will be triggered through the event handler.
  // Otherwise, an event of the packet's "type" will be triggered with the
  // packet data being passed.
  //
  // In the future, this will also be responsible for handling "special"
  // packets like heartbeats, etc. that are kept separate from the primary
  // payload packets.
  HelpEsb.Client.prototype._handlePacket = function(packet) {
    try {
      packet = JSON.parse(packet);
    } catch (e) {
      this._trigger('error', e);
      return;
    }

    this._trigger(packet.meta.type, packet.data);
  };

  // Triggers an event of the given type, passing along the remaining arguments
  // to all handlers that have been registered for the event.
  HelpEsb.Client.prototype._trigger = function(name) {
    if (typeof this._handlers[name] === 'undefined') {
      return;
    }

    var args = Array.prototype.slice.call(arguments, 1);

    this._handlers[name].forEach(function(handler) {
      handler.call({}, args);
    });
  };

  return HelpEsb;
}));

// [bluebird]: https://github.com/petkaantonov/bluebird