/*
  A simpe messages queue for IBM's Node-Red
  https://github.com/shady2k/node-red-contrib-simple-message-queue
  (c) 2017, shady2k <shady2k@gmail.com>
  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at
  http://www.apache.org/licenses/LICENSE-2.0
  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

module.exports = function (RED) {
	function isNormalInteger(str) {
		return /^\+?(0|[1-9]\d*)$/.test(str);
	}

	function setBusyFalse(smq) {
		clearTimeout(smq.bypassTimer);
		smq.bypassTimer = null;
		smq.isBusy = false;
	}

	function setBusyTrue(smq) {
		smq.isBusy = true;
	}

	function bypassQueue(smq, context, node) {
		if (smq.bypassInterval > 0 && context.queue.length > 0 && !smq.bypassTimer) {
			smq.bypassTimer = setTimeout(function bypassSend() {
				smq.bypassTimer = null;
				if (context.queue.length > 0) {
					var m = context.queue.shift();
					m["_queueCount"] = context.queue.length;
					node.send(m);

					if (context.queue.length == 0) {
						smq.isBusy = false;
					}

					if (context.queue.length > 0) {
						smq.bypassTimer = setTimeout(bypassSend, smq.bypassInterval);
					}

					updateStatus(smq, node);
				} else {
					smq.bypassTimer = null;
					smq.isBusy = false;
				}
			}, smq.bypassInterval);
		}
	}

	function stopBypassTimer(smq) {
		clearTimeout(smq.bypassTimer);
		smq.bypassTimer = null;
	}

	function updateStatus(smq, node) {
		const context = node.context();
		const queueL = context.queue.length.toString();
		if (context.isDisabled) {
			node.status({
				fill: "orange",
				shape: "ring",
				text: queueL + " (bypass all)"
			});
		} else if (smq.firstMessageBypass && !smq.isBusy) {
			node.status({
				fill: "blue",
				shape: "ring",
				text: queueL + " (bypass first)"
			});
		} else {
			node.status({
				fill: "green",
				shape: "ring",
				text: queueL
			});
		}
	}

	function SimpleMessageQueueNode(config) {

		RED.nodes.createNode(this, config);
		var smq = {};
		smq.firstMessageBypass = config.firstMessageBypass || false;
		smq.bypassInterval = config.bypassInterval || 0;
		smq.isBusy = false;
		smq.bypassTimer = null;
		var node = this;

		// Yes it's true: an incoming message just happened
		this.on("input", function (msg) {
			var now = Date.now;
			var context = node.context();

			// if queue doesn't exist, create it
			context.queue = context.queue || [];
			context.is_disabled = context.is_disabled || false;

			// if the msg is a reset, clear queue
			if (msg.hasOwnProperty("reset")) {
				context.queue = [];
				setBusyFalse(smq);
			} else if (msg.hasOwnProperty("queueCount")) {
				msg["_queueCount"] = context.queue.length;
				node.send(msg);
			} else if (msg.hasOwnProperty("bypassInterval")) {
				let re = /^\+?(0|[1-9]\d*)$/;
				if (re.test(msg.bypassInterval)) {
					smq.bypassInterval = msg.bypassInterval;
				}
			} else if (msg.hasOwnProperty("bypass")) {
				if (msg.bypass) {
					context.is_disabled = true;
				} else {
					context.is_disabled = false;
					setBusyFalse(smq);
					//context.queue = [];
				}
			} else if (msg.hasOwnProperty("trigger")) {   // if the msg is a trigger one release next message
				// Filter overdue messages
				context.queue = context.queue.filter(function (x) {
					return ((now() - x._queuetimestamp) < x.ttl || x.ttl == 0);
				});
				if (context.queue.length > 0) {
					var m = context.queue.shift();
					m["_queueCount"] = context.queue.length;
					node.send(m);
					stopBypassTimer(smq);
					bypassQueue(smq, context, node);
				} else {
					setBusyFalse(smq);
				}
			} else {
				if (context.is_disabled || (smq.firstMessageBypass && !smq.isBusy)) {
					setBusyTrue(smq);
					msg["_queueCount"] = context.queue.length;
					node.send(msg);
					stopBypassTimer(smq);
					bypassQueue(smq, context, node);
				} else {
					// Check if ttl value of new message is positive integer
					var ttl = msg.ttl || 0;
					if (!isNormalInteger(ttl)) ttl = 0;

					msg.ttl = ttl;
					msg._queuetimestamp = now();
					context.queue.push(msg); // Add to queue

					// Filter overdue messages
					context.queue = context.queue.filter(function (x) {
						return ((now() - x._queuetimestamp) < x.ttl || x.ttl == 0);
					});
				}
			}

			bypassQueue(smq, context, node);
			updateStatus(smq, node);
		});

		this.on("close", function () {
			updateStatus(smq, node);
		});
	}

	RED.nodes.registerType("simple-queue", SimpleMessageQueueNode);
};
