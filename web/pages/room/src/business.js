class Business {
  constructor({ room, media, view, socketBuilder, peerBuilder }) {
    this.room = room
    this.media = media
    this.view = view

    this.socketBuilder = socketBuilder
    this.peerBuilder = peerBuilder

    this.socket = {}
    this.currentStream = {}
    this.currentPeer = {}

    this.peers = new Map()
    this.usersRecordings = new Map()
  }

  static initialize(deps) {
    const instance = new Business(deps)
    return instance._init()
  }

  async _init() {
    this.view.configureRecordButton(this.onRecordPressed.bind(this))
    this.view.configureLeaveButton(this.onLeavePressed.bind(this))
    this.currentStream = await this.media.getCamera()
    this.socket = this.socketBuilder
      .setOnUserConnected(this.onUserConnected())
      .setOnUserDisconnected(this.onUserDisconnected())
      .build()
    this.currentPeer = await this.peerBuilder
      .setOnError(this.onPeerError())
      .setOnCallError(this.onPeerCallError())
      .setOnCallClose(this.onPeerCallClose())
      .setOnConnectionOpened(this.onPeerConnectionOpened())
      .setOnCallReceived(this.onPeerCallReceived())
      .setOnPeerStreamReceived(this.onPeerStreamReceived())
      .build()
    this.addVideoStream(this.currentPeer.id)
  }

  addVideoStream(userId, stream = this.currentStream) {
    const recorderInstance = new Recorder(userId, stream)
    this.usersRecordings.set(recorderInstance.filename, recorderInstance)
    if (this.recordingEnabled) {
      recorderInstance.startRecording()
    }
    const isCurrentId = userId === this.currentPeer.id
    this.view.renderVideo({
      userId,
      stream,
      isCurrentId,
    })
  }

  onUserConnected() {
    return (userId) => {
      console.log('user connected!', userId)
      this.currentPeer.call(userId, this.currentStream)
    }
  }

  onUserDisconnected() {
    return (userId) => {
      console.log('user disconnected!', userId)
      if (this.peers.has(userId)) {
        this.peers.get(userId).call.close()
        this.peers.delete(userId)
      }

      this.view.setParticipants(this.peers.size)
      this.stopRecording(userId)
      this.view.removeVideoElement(userId)
    }
  }

  onPeerError() {
    return (error) => {
      console.error('error on peer!', error)
    }
  }

  onPeerConnectionOpened() {
    return (peer) => {
      const id = peer.id
      console.log('peer', peer)
      this.socket.emit('join-room', this.room, id)
    }
  }

  onPeerCallReceived() {
    return (call) => {
      console.log('answering call', call)
      call.answer(this.currentStream)
    }
  }

  onPeerStreamReceived() {
    return (call, stream) => {
      const callerID = call.peer
      if (this.peers.has(callerID)) {
        console.log('called twice, ignoring second call...', callerID)
        return
      }
      this.addVideoStream(callerID, stream)
      this.peers.set(callerID, { call })

      this.view.setParticipants(this.peers.size)
    }
  }

  onPeerCallError() {
    return (call, error) => {
      console.log('a call error occurred', error)
      this.view.removeVideoElement(call.peer)
    }
  }

  onPeerCallClose() {
    return (call) => {
      console.log('call closed', call.peer)
    }
  }

  onRecordPressed(recordingEnabled) {
    this.recordingEnabled = recordingEnabled
    console.log('pressed', recordingEnabled)
    for (const [userId, recorder] of this.usersRecordings) {
      if (this.recordingEnabled) {
        recorder.startRecording()
        continue
      }
      this.stopRecording(userId)
    }
  }

  // If an user entered and exited the call during the recording
  // we need to stop all his old recordings
  async stopRecording(userId) {
    const usersRecordings = this.usersRecordings
    for (const [id, rec] of usersRecordings) {
      const isContextUser = id.includes(userId)
      if (!isContextUser) continue
      const isRecordingActive = rec.recordingActive
      if (!isRecordingActive) continue
      await rec.stopRecording()
      this.playRecordings(id)
    }
  }

  playRecordings(userId) {
    const user = this.usersRecordings.get(userId)
    const videoURLs = user.getAllVideoURLs()
    videoURLs.map((url) => {
      this.view.renderVideo({ url, userId })
    })
  }

  onLeavePressed() {
    this.usersRecordings.forEach((value, key) => value.download())
  }
}
