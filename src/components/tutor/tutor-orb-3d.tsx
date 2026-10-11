import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { VoiceState } from '@/lib/voice/types'

const vert = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vPos;
  uniform float uTime;
  uniform float uAmp;
  uniform float uPitch;
  uniform float uNoise;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec3 p = position;
    float freq = 2.4 + uPitch * 3.2;
    float n = sin(position.x * freq + uTime) * sin(position.y * (2.1 + uPitch) + uTime * (0.8 + uPitch));
    // Kept small enough that the displaced surface stays inside the camera frame.
    p += normal * n * uNoise * (0.05 + uAmp * 0.12 + uPitch * 0.06);
    vPos = p;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`

const frag = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vPos;
  uniform vec3 uColor;
  uniform float uGlow;
  uniform float uTime;
  void main() {
    vec3 light = normalize(vec3(0.4, 0.7, 1.0));
    float d = max(dot(normalize(vNormal), light), 0.0);
    float rim = pow(1.0 - max(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)), 0.0), 2.0);
    vec3 col = uColor * (0.25 + d * 0.75) + vec3(0.95, 0.88, 0.72) * rim * uGlow;
    float pulse = 0.85 + 0.15 * sin(uTime * 1.5);
    // Feather the silhouette so the blob has no hard outline.
    float edge = smoothstep(0.0, 0.3, max(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)), 0.0));
    gl_FragColor = vec4(col * pulse, edge);
  }
`

const stateParams: Record<VoiceState, { color: string; noise: number; glow: number; speed: number }> = {
  idle: { color: '#8a6a3a', noise: 0.35, glow: 0.35, speed: 0.25 },
  listening: { color: '#4d7c80', noise: 0.7, glow: 0.7, speed: 0.8 },
  processing: { color: '#8a6e3a', noise: 0.5, glow: 0.5, speed: 0.5 },
  thinking: { color: '#8a6e3a', noise: 0.9, glow: 0.45, speed: 0.35 },
  speaking: { color: '#c4a574', noise: 1.1, glow: 0.85, speed: 1.1 },
  paused: { color: '#6b675c', noise: 0.15, glow: 0.2, speed: 0.08 },
  error: { color: '#8a3c30', noise: 0.4, glow: 0.55, speed: 0.2 },
}

export default function TutorOrb3D({
  state,
  amplitude = 0,
  pitch = 0,
}: {
  state: VoiceState
  amplitude?: number
  pitch?: number
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const stateRef = useRef(state)
  const ampRef = useRef(amplitude)
  const pitchRef = useRef(pitch)
  useEffect(() => {
    stateRef.current = state
    ampRef.current = amplitude
    pitchRef.current = pitch
  }, [state, amplitude, pitch])

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    renderer.setSize(el.clientWidth, el.clientHeight)
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(32, el.clientWidth / el.clientHeight, 0.1, 20)
    camera.position.z = 5

    const uniforms = {
      uTime: { value: 0 },
      uAmp: { value: 0 },
      uPitch: { value: 0 },
      uNoise: { value: 0.35 },
      uGlow: { value: 0.35 },
      uColor: { value: new THREE.Color('#8a6a3a') },
    }
    const mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms,
      transparent: true,
    })
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.95, 5), mat)
    scene.add(mesh)
    scene.add(new THREE.AmbientLight(0xc4a574, 0.4))

    const onResize = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / Math.max(h, 1)
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(el)

    let raf = 0
    const tick = (t: number) => {
      const p = stateParams[stateRef.current]
      uniforms.uTime.value = reduced ? 0 : t / 1000
      uniforms.uAmp.value += (ampRef.current - uniforms.uAmp.value) * 0.12
      uniforms.uPitch.value += (pitchRef.current - uniforms.uPitch.value) * 0.1
      uniforms.uNoise.value += (p.noise + ampRef.current * 0.4 - uniforms.uNoise.value) * 0.06
      uniforms.uGlow.value += (p.glow + ampRef.current * 0.35 - uniforms.uGlow.value) * 0.06
      const listenTint = new THREE.Color(p.color).lerp(new THREE.Color('#7ec8c4'), pitchRef.current * 0.55)
      uniforms.uColor.value.lerp(listenTint, 0.08)
      if (!reduced) {
        mesh.rotation.y += 0.003 * (p.speed + pitchRef.current)
        mesh.rotation.x += 0.0015 * p.speed
      }
      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      mat.dispose()
      mesh.geometry.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  return <div ref={wrap} className="absolute inset-0" aria-hidden="true" />
}

