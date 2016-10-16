"use strict";

/*
Copyright (c) 2016 Ramón Baas

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

/*
   Fireplace driver for Mertik Maxitrol
*/

const commands = {
	'0010': 'DOWN',
	'0100': 'UP',
	'0011': 'RUN DOWN',
	'0101': 'RUN UP',
	'1100': 'OFF',
}

var signal;
var devices = {};
var timer;

var addDevice = (driver, device_data, name) => {
	if (devices[device_data.id] == null) {
		Homey.log('Adding', device_data);
		devices[device_data.id] = {
			driver: driver,
			device_data: device_data,
			name: name,
			data: { on: false, level: 0 }
		}
	}
}

function updateState(did, data) {
	devices[did].data = data;
	devices[did].driver.realtime(devices[did].device_data, 'onoff', data.on);
	devices[did].driver.realtime(devices[did].device_data, 'dim', data.level);
}

function sendCommand(channel, cmd) {
	for (var s in commands) {
		if (commands[s] == cmd) {
			Homey.log('Sending', cmd, 'for channel', channel);
			var bits = [ 1, 0, 1, 1];
			for (var i = 3; i >=0; i--) {
				bits.push((channel & Math.pow(2, i)) > 0 ? 1 : 0);
			}
			for (var i = 0; i < s.length; i++) {
				bits.push(s.charAt(i) == '1' ? 1 : 0);
			}
			signal.tx(bits, Homey.log);
		}
	}
}

function parseMertik(payload) {
	var bits = payload.join('');
	var valid = bits.slice(0, 4) == '1011';
	Homey.log(bits, valid);
	if (valid) {
		var channel = parseInt(bits.slice(4, 8), 2).toString(10);
		var cmd = bits.slice(-4);
		Homey.log('Channel', channel, 'Command', commands[cmd] || 'UNKNOWN');
		Homey.emit('remote_found', channel);
	}
}

var self = module.exports = {

	init: function(devices_data, callback) {
		Homey.log('Driver init');
		var HomeySignal = Homey.wireless('433').Signal;
		signal = new HomeySignal('Mertik');
		signal.register(function(err, success) {
			if (err != null) {
				Homey.log('Signal Mertik; err', err, 'success', success);
			} else { 
				Homey.log('Signal Mertik registered.')
				// Register data receive event
				signal.on('payload', function(payload, first) {
					var result = parseMertik(payload);
				});
			}
		});
		devices_data.forEach(function(device_data) {
			// Get the Homey name of the device
			self.getName(device_data, function(err, name) {
				addDevice(self, device_data, name);
			});
		});
		
		// we're ready
		callback();
	},
	
	capabilities: {
		onoff: {
			get: function(device_data, callback) {
					if (typeof callback == 'function' && devices[device_data.id] != null) {
						var val = devices[device_data.id].data.on;
						callback(null, val);
					} else {
						callback('Invalid');
					}
			},
			set: function(device_data, new_state, callback) {
				var did = device_data.id;
				if (devices[did] != null) {
					if (new_state == false || (new_state == true && devices[did].data.on != true)) {
						clearInterval(timer);
						sendCommand(device_data.channel, (new_state ? 'RUN UP' : 'RUN DOWN'));
						updateState(did, { on: new_state, level: new_state ? 1 : 0 });
					}
				}
			}
		},
		dim: {
			get: function(device_data, callback) {
					if (typeof callback == 'function' && devices[device_data.id] != null) {
						var val = devices[device_data.id].data.level;
						callback(null, val);
					} else {
						callback('Invalid');
					}
			},
			set: function(device_data, new_state, callback) {
				var did = device_data.id;
				if (devices[did] != null) {
					Homey.log('Dim', new_state);
					clearInterval(timer);
					if (new_state == 0) {
						self.capabilities.onoff.set(device_data, false, function(err, result) {});
					} if (new_state == 1) {
						self.capabilities.onoff.set(device_data, true, function(err, result) {});
					} else {
						var current = devices[did].data.level;
						var count = (new_state - current) * 25; // nr of cmds to send
						var cmd;
						if (count > 0) {
							cmd = 'UP';
						} else if (count < 0) {
							cmd = 'DOWN';
							count = -count;
						}
						timer = setInterval(function() {
							sendCommand(device_data.channel, cmd);
							count--;
							if (count == 0) {
								clearInterval(timer);
							}
						}, 150);
						updateState(did, { on: true, level: new_state });
					}
				}			
			}
		},
		updown: {
			set: function(device_data, new_state, callback) {
				var did = device_data.id;
				if (devices[did] != null) {
					clearInterval(timer);
					if (new_state == 'stop') {
						self.capabilities.onoff.set(device_data, false, function(err, result) {});
					} else {
						var level = devices[did].data.level;
						var cmd = new_state == 'up' ? 'UP' : 'DOWN';
						var newlevel = new_state == 'up' ? level + 0.04 : level - 0.04;
						if (newlevel > 0 && newlevel < 1) {
							sendCommand(device_data.channel, cmd);
							updateState(did, { on: true, level: newlevel });
						} else if (newlevel >= 1) {
							self.capabilities.onoff.set(device_data, true, function(err, result) {});
						} else {
							self.capabilities.onoff.set(device_data, false, function(err, result) {});
						}
					}
				}
			}
		}
	},

	added: function(device_data, callback) {
		// Update driver administration when a device is added
		self.getName(device_data, function(err, name) {
			addDevice(self, device_data, name);
		});

		callback();
	},
	
	renamed: function(device_data, new_name) {
		if (devices[device_data.id] != null) {
			Homey.log('Renaming', device_data, 'to', new_name);
			devices[device_data.id].name = new_name;
		}
	},
	
	deleted: function(device_data) {
		// Run when the user has deleted the device from Homey
		Homey.log('Deleting', device_data);
		delete devices[device_data.id];
	},
	
	pair: function(socket) {
		Homey.log('Fireplace remote pairing has started...');

		Homey.on('remote_found', function(data) {
			socket.emit('remote_found', data);
		});

		socket.on('completed', function(data, callback) {
			// Device has been added
			Homey.log('Pairing completed');
			callback();
		});
	}
}