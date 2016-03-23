'use strict';

const assert     = require('power-assert');
const proxyquire = require('proxyquire');
const sinon      = require('sinon');

const util       = require('../src/util');
const Negotiator = require('../src/negotiator');

let Connection;
let DataConnection;

describe('DataConnection', () => {
  let negotiatorStub;
  let startSpy;
  let cleanupSpy;
  let answerSpy;
  let candidateSpy;

  beforeEach(() => {
    // Negotiator stub and spies
    negotiatorStub = sinon.stub();
    startSpy = sinon.spy();
    cleanupSpy = sinon.spy();
    answerSpy = sinon.spy();
    candidateSpy = sinon.spy();

    negotiatorStub.returns({
      on: function(event, callback) {
        this[event] = callback;
      },
      emit: function(event, arg) {
        this[event](arg);
      },
      startConnection: startSpy,
      cleanup:         cleanupSpy,
      handleAnswer:    answerSpy,
      handleCandidate: candidateSpy
    });

    Connection = proxyquire(
      '../src/connection',
      {'./negotiator': negotiatorStub}
    );
    DataConnection = proxyquire(
      '../src/dataConnection',
      {'./connection': Connection}
    );
  });

  afterEach(() => {
    startSpy.reset();
    cleanupSpy.reset();
    answerSpy.reset();
    candidateSpy.reset();
  });

  describe('Constructor', () => {
    it('should call negotiator\'s startConnection method when created', () => {
      const dc = new DataConnection('remoteId', {});

      assert(dc);
      assert(startSpy.calledOnce);
    });

    it('should store any messages passed in when created', () => {
      const dc = new DataConnection('remoteId', {_queuedMessages: ['message']});
      assert.deepEqual(dc.options._queuedMessages, ['message']);
    });

    it('should set properties from arguments properly', () => {
      const id = 'remoteId';
      const label = 'label';
      const serialization = 'binary';
      const peerBrowser = 'browser';
      const metadata = 'meta';
      const options = {
        label:         label,
        serialization: serialization,
        metadata:      metadata,
        _payload:      {browser: peerBrowser}
      };

      const dc = new DataConnection(id, options);
      assert.equal(dc.type, 'data');
      assert.equal(dc.remoteId, id);
      assert.equal(dc.peer, id);
      assert.equal(dc.label, label);
      assert.equal(dc.serialization, serialization);
      assert.equal(dc.metadata, metadata);
      assert.equal(dc._peerBrowser, peerBrowser);
      assert.equal(dc.options, options);
    });
  });

  describe('Initialize', () => {
    it('should appropriately set and configure dc upon intialization', () => {
      const dcObj = {test: 'foobar'};

      const dc = new DataConnection('remoteId', {});
      dc._negotiator.emit('dcReady', dcObj);

      assert(dc._dc === dcObj);
      assert(dc._dc.onopen);
      assert(dc._dc.onmessage);
      assert(dc._dc.onclose);
    });

    it('should process any queued messages after PeerConnection object is created', () => {
      const messages = [{type: util.MESSAGE_TYPES.ANSWER.key, payload: 'message'}];

      let spy = sinon.spy();
      sinon.stub(DataConnection.prototype, 'handleAnswer', spy);
      const dc = new DataConnection('remoteId', {_queuedMessages: messages});

      assert.deepEqual(dc._queuedMessages, []);
      assert.equal(spy.calledOnce, true);

      spy.reset();
    });

    it('should correctly handle ALL of multiple queued messages', () => {
      const messages = [{type: util.MESSAGE_TYPES.ANSWER.key, payload: 'message1'},
                        {type: util.MESSAGE_TYPES.CANDIDATE.key, payload: 'message2'}];

      let spy1 = sinon.spy();
      let spy2 = sinon.spy();
      sinon.stub(DataConnection.prototype, 'handleAnswer', spy1);
      sinon.stub(DataConnection.prototype, 'handleCandidate', spy2);

      const dc = new DataConnection('remoteId', {_queuedMessages: messages});
      // dc._pcAvailable = true;

      assert.deepEqual(dc._queuedMessages, []);
      assert.equal(spy1.calledOnce, true);
      assert.equal(spy2.calledOnce, true);
    });

    it('should not process any invalid queued messages', () => {
      const messages = [{type: 'WRONG', payload: 'message'}];

      let spy1 = sinon.spy();
      let spy2 = sinon.spy();
      sinon.stub(DataConnection.prototype, 'handleAnswer', spy1);
      sinon.stub(DataConnection.prototype, 'handleCandidate', spy2);

      const dc = new DataConnection('remoteId', {_queuedMessages: messages});
      // dc._pcAvailable = true;

      assert.deepEqual(dc._queuedMessages, []);
      assert.equal(spy1.called, false);
      assert.equal(spy2.called, false);
    });

    it('should open the DataConnection and emit upon _dc.onopen()', () => {
      let spy;

      const dc = new DataConnection('remoteId', {});
      dc._negotiator.emit('dcReady', {});

      spy = sinon.spy(dc, 'emit');

      assert.equal(dc.open, false);
      dc._dc.onopen();
      assert.equal(dc.open, true);
      assert(spy.calledOnce);

      spy.reset();
    });

    it('should handle a message upon _dc.onmessage()', () => {
      const message = 'foobar';
      const data = {
        id:         'test',
        index:      0,
        totalParts: 1,
        data:       message
      };
      const packedData = util.pack(data);

      const dc = new DataConnection('remoteId', {});
      dc._negotiator.emit('dcReady', {});

      let spy = sinon.spy(dc, '_handleDataMessage');

      dc._dc.onmessage(message);
      assert(spy.calledOnce);
      assert(spy.calledWith, packedData);

      spy.reset();
    });

    it('should close the DataConnection upon _dc.onclose()', () => {
      let spy;

      const dc = new DataConnection('remoteId', {});
      dc._negotiator.emit('dcReady', {});

      spy = sinon.spy(dc, 'close');
      dc._dc.onclose();
      assert(spy.calledOnce);

      spy.reset();
    });
  });

  describe('_setupNegotiatorMessageHandlers', () => {
    let dc;
    beforeEach(() => {
      dc = new DataConnection('remoteId', {});
    });

    it('should emit \'candidate\' on negotiator \'iceCandidate\' event', done => {
      const candidate = Symbol();
      dc.on(Connection.EVENTS.candidate.key, connectionCandidate => {
        assert(connectionCandidate);
        assert.equal(connectionCandidate.candidate, candidate);
        assert.equal(connectionCandidate.dst, dc.remoteId);
        assert.equal(connectionCandidate.connectionId, dc.id);
        assert.equal(connectionCandidate.connectionType, dc.type);
        done();
      });

      dc._negotiator.emit(Negotiator.EVENTS.iceCandidate.key, candidate);
    });

    it('should emit \'answer\' on negotiator \'answerCreated\' event', done => {
      const answer = Symbol();
      dc.on(Connection.EVENTS.answer.key, connectionCandidate => {
        assert(connectionCandidate);
        assert.equal(connectionCandidate.answer, answer);
        assert.equal(connectionCandidate.dst, dc.remoteId);
        assert.equal(connectionCandidate.connectionId, dc.id);
        assert.equal(connectionCandidate.connectionType, dc.type);
        done();
      });

      dc._negotiator.emit(Negotiator.EVENTS.answerCreated.key, answer);
    });

    it('should emit \'offer\' on negotiator \'offerCreated\' event', done => {
      const offer = Symbol();
      dc.on(Connection.EVENTS.offer.key, connectionOffer => {
        assert(connectionOffer);
        assert.equal(connectionOffer.offer, offer);
        assert.equal(connectionOffer.dst, dc.remoteId);
        assert.equal(connectionOffer.connectionId, dc.id);
        assert.equal(connectionOffer.connectionType, dc.type);
        assert.equal(connectionOffer.serialization, dc.serialization);
        assert.equal(connectionOffer.label, dc.label);
        assert.equal(connectionOffer.metadata, dc.metadata);
        done();
      });

      dc._negotiator.emit(Negotiator.EVENTS.offerCreated.key, offer);
    });
  });

  describe('Handle Message', () => {
    it('should recorrect unpack a string message', done => {
      const message = 'foobar';
      const dataMeta = {
        id:         'test',
        index:      0,
        totalParts: 1,
        data:       message,
        type:       typeof message
      };

      const dc = new DataConnection('remoteId', {});
      dc._negotiator.emit('dcReady', {});

      dc.on('data', data => {
        assert.equal(data, message);
        done();
      });

      util.blobToArrayBuffer(util.pack(dataMeta), ab => {
        dc._handleDataMessage(ab);
      });
    });

    it('should correctly unpack JSON messages', done => {
      const jsonObj = {'name': 'testObject'};
      // JSON data is binary packed for compression purposes
      const packedJson = util.pack(jsonObj);

      const dataMeta = {
        id:         'test',
        index:      0,
        totalParts: 1,
        data:       packedJson,
        type:       'json'
      };

      const dc = new DataConnection('remoteId', {});
      dc._negotiator.emit('dcReady', {});

      dc.on('data', data => {
        assert.deepEqual(data, jsonObj);
        done();
      });

      util.blobToArrayBuffer(util.pack(dataMeta), ab => {
        dc._handleDataMessage(ab);
      });
    });

    it('should correctly handle ArrayBuffer messages', done => {
      const message = 'foobar';
      const abMessage = util.binaryStringToArrayBuffer(message);

      const dataMeta = {
        id:         'test',
        index:      0,
        totalParts: 1,
        data:       abMessage,
        type:       'arraybuffer'
      };

      const dc = new DataConnection('remoteId', {});
      dc._negotiator.emit('dcReady', {});

      dc.on('data', data => {
        // We want to check that the received data is an ArrayBuffer
        assert.deepEqual(data, abMessage);
        done();
      });

      util.blobToArrayBuffer(util.pack(dataMeta), ab => {
        dc._handleDataMessage(ab);
      });
    });

    it('should correctly handle Blob messages', done => {
      const message = 'foobar';
      const blob = new Blob([message], {type: 'text/plain'});

      const dataMeta = {
        id:         'test',
        index:      0,
        totalParts: 1,
        data:       blob,
        type:       blob.type
      };

      const dc = new DataConnection('remoteId', {});
      dc._negotiator.emit('dcReady', {});

      dc.on('data', data => {
        // We want to check that the received data is an ArrayBuffer
        assert.deepEqual(data, blob);
        done();
      });

      util.blobToArrayBuffer(util.pack(dataMeta), ab => {
        dc._handleDataMessage(ab);
      });
    });

    it('should correctly reconstruct a sent file', done => {
      const fileType = 'text/plain;charset=utf-8;';
      const file = new File(['foobar'], 'testfile', {
        type: fileType
      });

      const dc = new DataConnection('remoteId', {serialization: 'binary'});
      dc._negotiator.emit('dcReady', {});

      const dataMeta = {
        id:         'test',
        index:      0,
        totalParts: 1,
        data:       file,
        name:       file.name,
        type:       file.type
      };

      dc.on('data', data => {
        assert.deepEqual(data, file);
        done();
      });

      util.blobToArrayBuffer(util.pack(dataMeta), ab => {
        dc._handleDataMessage(ab);
      });
    });

    it('should be able to recombine chunked messages', done => {
      // Chunk size is 16300
      // Each char is 2 bytes
      const len = 20000;
      const string = new Array(len + 1).join('a');

      const slice1 = string.slice(0, util.maxChunkSize);
      const slice2 = string.slice(util.maxChunkSize, util.maxChunkSize * 2);

      const dataMeta1 = {
        id:         'test',
        index:      0,
        totalParts: 2,
        data:       slice1,
        type:       typeof slice1
      };
      const dataMeta2 = {
        id:         'test',
        index:      1,
        totalParts: 2,
        data:       slice2,
        type:       typeof slice2
      };

      const dc = new DataConnection('remoteId', {});
      dc._negotiator.emit('dcReady', {});

      dc.on('data', data => {
        // Receives the reconstructed string after all chunks have been handled
        assert.deepEqual(data, string);
        done();
      });

      util.blobToArrayBuffer(util.pack(dataMeta1), ab1 => {
        util.blobToArrayBuffer(util.pack(dataMeta2), ab2 => {
          dc._handleDataMessage(ab1);
          dc._handleDataMessage(ab2);
        });
      });
    });
  });

  describe('Send', () => {
    it('should emit an error if send() is called while DC is not open', done => {
      const dc = new DataConnection('remoteId', {});
      assert.equal(dc.open, false);

      dc.on('error', error => {
        assert(error instanceof Error);
        done();
      });

      dc.send('foobar', false);
    });

    it('should correctly send string messages', done => {
      const message = 'foobar';
      let sendSpy = sinon.spy();

      const dc = new DataConnection('remoteId', {});
      dc._negotiator.emit('dcReady', {send: sendSpy});
      dc._dc.onopen();

      setTimeout(() => {
        assert(sendSpy.calledOnce);

        const unpackedData = util.unpack(sendSpy.args[0][0]);
        assert.equal(unpackedData.data, message);
        done();
      }, 100);

      dc.send(message);
    });

    it.only('should correctly pack and send JSON data', done => {
      const jsonObj = {'name': 'testObject'};
      let sendSpy = sinon.spy();

      const dc = new DataConnection('remoteId', {});
      dc._negotiator.emit('dcReady', {send: sendSpy});
      dc._dc.onopen();

      setTimeout(() => {
        assert(sendSpy.calledOnce);

        const unpacked = util.unpack(sendSpy.args[0][0]);
        const data = util.unpack(unpacked.data);
        assert.deepEqual(data, jsonObj);
        done();
      }, 100);

      dc.send(jsonObj);
    });

    it('should stringify JSON data and call _bufferedSend', () => {
      const obj = {name: 'foobar'};

      const dc = new DataConnection('remoteId', {});
      dc._negotiator.emit('dcReady', {});
      dc._dc.onopen();
      dc.serialization = 'json';

      let spy = sinon.spy(dc, '_bufferedSend');

      dc.send(obj, false);
      assert(spy.calledOnce);
      assert(spy.calledWith(JSON.stringify(obj)));

      spy.reset();
    });

    it('should call _bufferedSend on data with non-regular types of serialization', () => {
      const message = 'foobar';

      const dc = new DataConnection('remoteId', {});
      dc._negotiator.emit('dcReady', {});
      dc._dc.onopen();
      dc.serialization = 'test';

      let spy = sinon.spy(dc, '_bufferedSend');

      dc.send(message, false);
      assert(spy.calledOnce);
      assert(spy.calledWith(message));

      spy.reset();
    });

    it('should send data as a Blob if serialization is binary', () => {
      const message = 'foobar';

      util.supports = {binaryBlob: true};
      DataConnection = proxyquire(
        '../src/dataConnection',
        {'./connection': Connection,
         './util':       util}
      );

      const dc = new DataConnection('remoteId', {});
      dc._negotiator.emit('dcReady', {});
      dc._dc.onopen();
      dc.serialization = 'binary';

      let spy = sinon.spy(dc, '_bufferedSend');

      dc.send(message, false);
      assert(spy.calledOnce);
      assert(spy.args[0][0] instanceof Blob);

      spy.reset();
    });

    it('should convert a Blob to an ArrayBuffer if Blobs are not supported', done => {
      util.supports = {binaryBlob: false};

      DataConnection = proxyquire(
        '../src/dataConnection',
        {'./connection': Connection,
         './util':       util}
      );
      const message = 'foobar';

      const dc = new DataConnection('remoteId', {});
      dc._negotiator.emit('dcReady', {});
      dc._dc.onopen();
      dc.serialization = 'binary';

      let spy = sinon.spy(dc, '_bufferedSend');

      dc.send(message, false);

      setTimeout(() => {
        assert(spy.calledOnce);
        assert(spy.args[0][0] instanceof ArrayBuffer);

        spy.reset();
        done();
      }, 100);
    });

    describe('Helper Methods', () => {
      it('should push a message onto the buffer if we are buffering', () => {
        const message = 'foobar';

        const dc = new DataConnection('remoteId', {});
        dc._negotiator.emit('dcReady', {});
        dc._dc.onopen();

        dc._isBuffering = true;
        dc._bufferedSend(message);

        assert.deepEqual(dc._buffer, [message]);
        assert.equal(dc._buffer.length, 1);
      });

      it('should return `true` to _trySend if the DataChannel send succeeds', () => {
        const message = 'foobar';

        const dc = new DataConnection('remoteId', {});
        dc._negotiator.emit('dcReady', {});
        dc._dc.send = () => {
          return true;
        };
        dc._dc.onopen();

        const result = dc._trySend(message);
        assert.equal(result, true);
      });

      it('should return `false` to _trySend and start buffering if the DataChannel send fails', done => {
        const message = 'foobar';

        const dc = new DataConnection('remoteId', {});
        dc._negotiator.emit('dcReady', {});
        dc._dc.send = () => {
          const error = new Error();
          throw error;
        };
        dc._dc.onopen();

        let spy = sinon.spy(dc, '_tryBuffer');

        const result = dc._trySend(message);
        assert.equal(result, false);
        assert.equal(dc._isBuffering, true);

        setTimeout(() => {
          assert(spy.calledOnce);

          spy.reset();
          done();
        }, 100);
      });

      it('should not try to call _trySend if buffer is empty when _tryBuffer is called', () => {
        const dc = new DataConnection('remoteId', {});
        dc._negotiator.emit('dcReady', {});
        dc._dc.onopen();

        let spy = sinon.spy(dc, '_trySend');

        dc._buffer = [];
        dc._tryBuffer();
        assert.equal(spy.called, false);
      });

      it('should try and send the first message in buffer when _tryBuffer is called', () => {
        const message = 'foobar';

        const dc = new DataConnection('remoteId', {});
        dc._negotiator.emit('dcReady', {});
        dc._dc.send = () => {
          return true;
        };
        dc._dc.onopen();

        let spy = sinon.spy(dc, '_trySend');

        dc._buffer = [message];
        dc._tryBuffer();

        assert(spy.calledOnce);
        assert(spy.calledWith(message));
        assert.deepEqual(dc._buffer, []);
        assert.equal(dc._buffer.length, 0);
      });
    });
  });

  describe('Cleanup', () => {
    it('should close the socket and call the negotiator to cleanup on close()', () => {
      const dc = new DataConnection('remoteId', {});

      // Force to be open
      dc.open = true;

      let spy = sinon.spy(dc, 'close');

      dc.close();
      assert(dc);
      assert(spy.calledOnce);
      assert.equal(dc.open, false);

      assert(cleanupSpy.called);
    });
  });
});
