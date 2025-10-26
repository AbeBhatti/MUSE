import * as Tone from 'tone'
import { Midi } from '@tonejs/midi'

let midiData: Midi | null = null
let notes: Array<{ id: string; midi: number; time: number; duration: number; velocity: number; name: string; trackIndex: number }> = []
let isPlaying = false
let currentTime = 0
let duration = 0
let playInterval: number | null = null
let synth: Tone.PolySynth | null = null
let selectedNotes = new Set<string>()
let maxConcurrentNotes = 32

const NOTE_HEIGHT = 20
let PIXELS_PER_SECOND = 100
const MIDI_NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']

function changeZoom(delta: number) {
  PIXELS_PER_SECOND = Math.max(25, Math.min(400, PIXELS_PER_SECOND + delta))
  const zoomPercent = Math.round((PIXELS_PER_SECOND / 100) * 100)
  const zoomLevel = document.getElementById('zoomLevel')!
  zoomLevel.textContent = `${zoomPercent}%`
  if (notes.length > 0) renderPianoRoll()
}

async function initSynth() {
  if (!synth) {
    await Tone.start()
    synth = new Tone.PolySynth(Tone.Synth, {
      maxPolyphony: 128,
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.5 }
    }).toDestination()
    synth.volume.value = -10
  }
}

function bindInputs() {
  const audioInput = document.getElementById('audioInput') as HTMLInputElement
  audioInput.addEventListener('change', async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    startTranscription(file)
  })
  const midiInput = document.getElementById('midiInput') as HTMLInputElement
  midiInput.addEventListener('change', async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    const arrayBuffer = await file.arrayBuffer()
    loadMIDI(arrayBuffer, file.name)
  })

  document.getElementById('playBtn')!.addEventListener('click', togglePlay)
  document.getElementById('zoomIn')!.addEventListener('click', () => changeZoom(50))
  document.getElementById('zoomOut')!.addEventListener('click', () => changeZoom(-50))
}

async function startTranscription(file: File) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('onset_threshold', '0.5')
  formData.append('frame_threshold', '0.3')
  formData.append('min_note_len', '0.127')
  formData.append('min_freq', '')
  formData.append('max_freq', '')
  formData.append('melodia_trick', 'true')

  const response = await fetch(`/upload`, { method: 'POST', body: formData })
  if (!response.ok) throw new Error(await response.text())
  const result = await response.json()
  const midiResponse = await fetch(`/midi/${result.filename}`)
  if (!midiResponse.ok) throw new Error('Failed to fetch MIDI file')
  const midiBuffer = await midiResponse.arrayBuffer()
  loadMIDI(midiBuffer, result.filename)
}

async function loadMIDI(arrayBuffer: ArrayBuffer, filename: string) {
  midiData = new Midi(arrayBuffer)
  notes = []
  midiData.tracks.forEach((track, trackIndex) => {
    track.notes.forEach(note => {
      const d = Math.max(note.duration || 0.1, 0.1)
      const t = Math.max(note.time || 0, 0)
      notes.push({ midi: note.midi, time: t, duration: d, velocity: note.velocity, name: note.name, trackIndex, id: `${trackIndex}-${t}-${note.midi}` })
    })
  })
  duration = midiData.duration || 10
  currentTime = 0
  if (notes.length > 0 && duration === 0) duration = Math.max(...notes.map(n => n.time + n.duration))
  ;(document.getElementById('fileInfo') as HTMLElement).textContent = `${filename} - ${notes.length} notes`
  ;(document.getElementById('playBtn') as HTMLButtonElement).disabled = false
  ;(document.getElementById('saveBtn') as HTMLButtonElement).disabled = false
  await initSynth()
  renderPianoRoll()
  renderPianoKeys()
  updateTimeDisplay()
}

function renderPianoKeys() {
  const pianoKeys = document.getElementById('pianoKeys')!
  pianoKeys.innerHTML = ''
  for (let midi = 108; midi >= 21; midi--) {
    const noteName = MIDI_NOTE_NAMES[midi % 12] + Math.floor(midi / 12 - 1)
    const key = document.createElement('div')
    key.className = 'piano-key ' + ([1,3,6,8,10].includes(midi % 12) ? 'black' : 'white')
    key.textContent = noteName
    pianoKeys.appendChild(key)
  }
}

function renderPianoRoll() {
  const roll = document.getElementById('pianoRoll')!
  roll.innerHTML = ''
  const content = document.createElement('div')
  content.className = 'piano-roll-canvas'
  const height = (108 - 21 + 1) * NOTE_HEIGHT
  const width = Math.max(800, Math.ceil(duration * PIXELS_PER_SECOND))
  content.style.height = height + 'px'
  content.style.width = width + 'px'
  roll.appendChild(content)

  for (let midi = 21; midi <= 108; midi++) {
    const y = (108 - midi) * NOTE_HEIGHT
    const hline = document.createElement('div')
    hline.className = 'grid-line horizontal'
    hline.style.top = (y + NOTE_HEIGHT - 1) + 'px'
    content.appendChild(hline)
  }
  const totalSeconds = Math.ceil(duration)
  for (let s = 0; s <= totalSeconds; s++) {
    const x = s * PIXELS_PER_SECOND
    const vline = document.createElement('div')
    vline.className = 'grid-line vertical'
    vline.style.left = x + 'px'
    content.appendChild(vline)
  }

  notes.forEach(n => {
    const div = document.createElement('div')
    div.className = 'note'
    const x = Math.max(0, Math.min(width, n.time * PIXELS_PER_SECOND))
    const w = Math.max(2, n.duration * PIXELS_PER_SECOND)
    const y = (108 - n.midi) * NOTE_HEIGHT
    div.style.left = x + 'px'
    div.style.top = y + 'px'
    div.style.width = w + 'px'
    div.style.height = (NOTE_HEIGHT - 2) + 'px'
    div.title = `${n.name} @ ${n.time.toFixed(2)}s`
    div.addEventListener('click', (e) => {
      e.stopPropagation()
      if (selectedNotes.has(n.id)) { selectedNotes.delete(n.id); div.classList.remove('selected') }
      else { selectedNotes.add(n.id); div.classList.add('selected') }
      ;(document.getElementById('deleteBtn') as HTMLButtonElement).disabled = selectedNotes.size === 0
    })
    content.appendChild(div)
  })

  const playhead = document.createElement('div')
  playhead.id = 'playhead'
  playhead.className = 'playhead'
  content.appendChild(playhead)

  roll.addEventListener('click', (e) => {
    const rect = roll.getBoundingClientRect()
    const x = (e as MouseEvent).clientX - rect.left + roll.scrollLeft
    seekToPosition(x / PIXELS_PER_SECOND)
  })
}

function updateTimeDisplay() {
  const fmt = (t: number) => `${Math.floor(t/60)}:${Math.floor(t%60).toString().padStart(2,'0')}`
  ;(document.getElementById('timeDisplay') as HTMLElement).textContent = `${fmt(currentTime)} / ${fmt(duration)}`
}

async function togglePlay() {
  await initSynth()
  if (!isPlaying) {
    isPlaying = true
    document.getElementById('playBtn')!.classList.add('playing')
    startPlayback()
  } else {
    isPlaying = false
    document.getElementById('playBtn')!.classList.remove('playing')
    stopPlayback()
  }
}

function startPlayback() {
  if (!synth) return
  const startTime = Tone.now()
  const startOffset = currentTime
  let concurrent = 0
  notes.forEach(n => {
    if (n.time + n.duration < startOffset) return
    const scheduleAt = startTime + Math.max(0, n.time - startOffset)
    if (concurrent < maxConcurrentNotes) {
      setTimeout(() => {
        if (!isPlaying || !synth) return
        try {
          const freq = Tone.Frequency(n.midi, 'midi')
          synth.triggerAttackRelease(freq, n.duration, undefined, n.velocity)
        } catch {}
      }, Math.max(0, (scheduleAt - Tone.now()) * 1000))
      concurrent++
    }
  })

  playInterval = window.setInterval(() => {
    currentTime += 0.05
    if (currentTime >= duration) { currentTime = duration; togglePlay() }
    const playhead = document.getElementById('playhead') as HTMLElement | null
    if (playhead) playhead.style.left = (currentTime * PIXELS_PER_SECOND) + 'px'
    const progress = document.getElementById('progressBar') as HTMLElement | null
    if (progress) progress.style.width = ((currentTime / duration) * 100) + '%'
    updateTimeDisplay()
  }, 50)
}

function stopPlayback() {
  if (playInterval) window.clearInterval(playInterval)
  playInterval = null
}

function seekToPosition(t: number) {
  currentTime = Math.max(0, Math.min(duration, t))
  const playhead = document.getElementById('playhead') as HTMLElement | null
  if (playhead) playhead.style.left = (currentTime * PIXELS_PER_SECOND) + 'px'
  const progress = document.getElementById('progressBar') as HTMLElement | null
  if (progress) progress.style.width = ((currentTime / duration) * 100) + '%'
  updateTimeDisplay()
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  bindInputs()
  const resumeAudio = async () => {
    try { await initSynth() } catch {}
    document.removeEventListener('click', resumeAudio, true)
    document.removeEventListener('touchstart', resumeAudio, true)
  }
  document.addEventListener('click', resumeAudio, true)
  document.addEventListener('touchstart', resumeAudio, true)
})
