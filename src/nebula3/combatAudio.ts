import { Vector3 } from 'three';
import type { Camera } from 'three';
import laser from '../../audio/laser.mp3?url';
import impact from '../../audio/impact.mp3?url';
import explosion from '../../audio/explosion.mp3?url';
import explosion2 from '../../audio/explosion2.mp3?url';
import shield from '../../audio/shield.mp3?url';
import alert from '../../audio/alert.mp3?url';

export type SoundKind = 'shot' | 'hit' | 'blast' | 'bomb' | 'shield' | 'alert';
type FileKind = SoundKind;

const files: Record<FileKind, string> = {
  shot: laser, hit: impact, blast: explosion, bomb: explosion2, shield, alert
};
const volume: Record<SoundKind, number> = {
  shot: .32, hit: .4, blast: .7, bomb: .85, shield: .5, alert: .35
};
const fallback: Record<SoundKind, [number, number, number]> = {
  shot: [510, 180, .1], hit: [160, 55, .14], blast: [105, 28, .5],
  bomb: [90, 22, .7], shield: [330, 90, .2], alert: [460, 220, .3]
};

export class CombatAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private loading: Promise<PromiseSettledResult<void>[]> | null = null;
  private buffers = new Map<FileKind, AudioBuffer>();
  private last = new Map<SoundKind, number>();
  private active = 0;
  private right = new Vector3();
  private direction = new Vector3();

  constructor(
    private controls: { effects: HTMLInputElement; volume: HTMLInputElement; preview: HTMLButtonElement },
    private camera: () => Camera
  ) {
    controls.preview.addEventListener('click', async () => {
      this.wake();
      await this.loading;
      this.play('shot');
      setTimeout(() => this.play('hit'), 270);
      setTimeout(() => this.play('bomb'), 600);
    });
  }

  setVolume() {
    if (this.master) this.master.gain.value = Number(this.controls.volume.value) / 100;
  }

  wake() {
    if (!this.controls.effects.checked) return;
    try {
      if (!this.context) {
        const AudioClass = window.AudioContext ||
          (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioClass) return;
        this.context = new AudioClass();
        const limiter = this.context.createDynamicsCompressor();
        limiter.threshold.value = -16;
        limiter.ratio.value = 3;
        this.master = this.context.createGain();
        this.setVolume();
        this.master.connect(limiter).connect(this.context.destination);
      }
      if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
      this.loading ||= Promise.allSettled(
        (Object.entries(files) as [FileKind, string][]).map(async ([kind, url]) => {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`Audio unavailable: ${url}`);
          this.buffers.set(kind, await this.context!.decodeAudioData(await response.arrayBuffer()));
        })
      );
    } catch {
      this.controls.effects.checked = false;
    }
  }

  play(kind: SoundKind, position: Vector3 | null = null) {
    const context = this.context;
    if (!context || !this.master || context.state !== 'running' ||
        !this.controls.effects.checked || this.active >= 18) return;

    const now = context.currentTime;
    const interval = kind === 'shot' ? .11 : kind === 'hit' ? .08 : .22;
    if (now - (this.last.get(kind) ?? -100) < interval) return;
    this.last.set(kind, now);

    const buffer = this.buffers.get(kind);
    const gain = context.createGain();
    const panner = context.createStereoPanner?.();
    const listener = this.camera();
    const distance = position ? position.distanceTo(listener.position) : 0;
    gain.gain.value = volume[kind] / (1 + distance / 260);

    if (panner) {
      this.right.set(1, 0, 0).applyQuaternion(listener.quaternion);
      panner.pan.value = position ? Math.max(-.85, Math.min(.85,
        this.right.dot(this.direction.subVectors(position, listener.position)) / Math.max(distance, 1))) : 0;
      gain.connect(panner).connect(this.master);
    } else {
      gain.connect(this.master);
    }

    let source: AudioScheduledSourceNode;
    if (buffer) {
      const player = context.createBufferSource();
      player.buffer = buffer;
      player.playbackRate.value = (kind === 'bomb' ? .8 : 1) * (.94 + Math.random() * .12);
      player.connect(gain);
      source = player;
      player.start(now);
    } else {
      // Audible feedback remains if a sample cannot be loaded.
      const tone = context.createOscillator();
      const [start, end, duration] = fallback[kind];
      tone.type = kind === 'alert' ? 'triangle' : 'sawtooth';
      tone.frequency.setValueAtTime(start, now);
      tone.frequency.exponentialRampToValueAtTime(end, now + duration);
      gain.gain.setValueAtTime(Math.max(gain.gain.value, .0001), now);
      gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
      tone.connect(gain);
      source = tone;
      tone.start(now);
      tone.stop(now + duration);
    }
    this.active++;
    source.onended = () => {
      source.disconnect(); gain.disconnect(); panner?.disconnect();
      this.active--;
    };
  }
}
