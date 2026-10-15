'use client';

/**
 * Dynamic three.js scene module — imported ONLY on the client via import()
 * from three-d.tsx, so the heavy WebGL stack never enters the server bundle.
 *
 * Kept separate from three-d.tsx so the dynamic chunk boundary is explicit:
 * three-d.tsx is tiny, this module pulls in three + R3F + drei (~120-150KB
 * gzip split across the trio).
 */

import { Canvas, useFrame } from '@react-three/fiber';
import { Float, Icosahedron, MeshDistortMaterial, Torus, Sphere, TorusKnot } from '@react-three/drei';
import * as THREE from 'three';
import { Suspense, useRef } from 'react';

function rgbVar(name: string): string {
  // CSS vars can't be read inside the canvas (no DOM colors in WebGL), so map
  // the handful of vars agents may use to hex; anything else falls back.
  const map: Record<string, string> = {
    'var(--brand-primary)': '#4f7cff',
    'var(--brand-accent)': '#ff7a59',
    'var(--text-primary)': '#111827',
    'var(--text-muted)': '#6b7280',
    'var(--bg-canvas)': '#f8fafc',
  };
  return map[name] ?? '#4f7cff';
}

function Shape({ shape, color, wireframe }: { shape: string; color: string; wireframe: boolean }) {
  const mesh = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (!mesh.current) return;
    const t = state.clock.elapsedTime;
    mesh.current.rotation.x = t * 0.12;
    mesh.current.rotation.y = t * 0.18;
    // Gentle breathing scale
    const s = 1 + Math.sin(t * 0.8) * 0.04;
    mesh.current.scale.setScalar(s);
  });

  const common = { color: rgbVar(color), wireframe };

  switch (shape) {
    case 'torus':
      return (
        <Torus ref={mesh} args={[1, 0.38, 24, 80]}>
          <MeshDistortMaterial {...common} distort={0.25} speed={1.6} metalness={0.4} roughness={0.3} />
        </Torus>
      );
    case 'icosahedron':
      return (
        <Icosahedron ref={mesh} args={[1.2, 0]}>
          <MeshDistortMaterial {...common} distort={0.4} speed={2} metalness={0.1} roughness={0.4} />
        </Icosahedron>
      );
    case 'sphere':
      return (
        <Sphere ref={mesh} args={[1.15, 48, 48]}>
          <MeshDistortMaterial {...common} distort={0.35} speed={1.8} metalness={0.2} roughness={0.35} />
        </Sphere>
      );
    case 'torus-knot':
      return (
        <TorusKnot ref={mesh} args={[1, 0.32, 160, 24]}>
          <MeshDistortMaterial {...common} distort={0.2} speed={1.4} metalness={0.5} roughness={0.25} />
        </TorusKnot>
      );
    default:
      return null;
  }
}

export function Scene3DCanvasInner({
  speed = 1,
  shape = 'torus',
  color = 'var(--brand-primary)',
  wireframe = false,
}: {
  speed?: number;
  shape?: 'torus' | 'icosahedron' | 'sphere' | 'torus-knot';
  color?: string;
  wireframe?: boolean;
}) {
  return (
    <Canvas
      camera={{ position: [0, 0, 5], fov: 45 }}
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: true }}
      style={{ width: '100%', height: '100%', background: 'transparent' }}
    >
      <Suspense fallback={null}>
        <ambientLight intensity={0.55} />
        <pointLight position={[6, 6, 6]} intensity={1.4} />
        <directionalLight position={[-4, -2, -3]} intensity={0.7} color="#ffffff" />
        <Float speed={2 * speed} rotationIntensity={0.6} floatIntensity={0.8}>
          <Shape shape={shape} color={color} wireframe={wireframe} />
        </Float>
      </Suspense>
    </Canvas>
  );
}