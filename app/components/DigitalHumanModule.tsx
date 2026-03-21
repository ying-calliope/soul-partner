"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";

class Model {
  public vrm: VRM | null = null;
  public mixer?: THREE.AnimationMixer;
  private lookAtTarget: THREE.Object3D;

  constructor(lookAtTarget: THREE.Object3D) {
    this.lookAtTarget = lookAtTarget;
  }

  async loadVRM(url: string) {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url);

    const vrm = gltf.userData.vrm as VRM;
    vrm.scene.name = "VRMRoot";
    VRMUtils.rotateVRM0(vrm);

    this.vrm = vrm;
    this.mixer = new THREE.AnimationMixer(vrm.scene);
    if (vrm.lookAt) {
      vrm.lookAt.target = this.lookAtTarget;
    }
  }

  unload() {
    if (!this.vrm) return;
    VRMUtils.deepDispose(this.vrm.scene);
    this.vrm = null;
  }

  update(delta: number) {
    this.mixer?.update(delta);
    this.vrm?.update(delta);
  }
}

class Viewer {
  public model?: Model;
  private renderer?: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;
  private controls?: OrbitControls;
  private clock: THREE.Clock;
  private lookAtTarget: THREE.Object3D;
  private raf = 0;

  constructor() {
    this.scene = new THREE.Scene();
    this.clock = new THREE.Clock();
    this.lookAtTarget = new THREE.Object3D();
    this.scene.add(this.lookAtTarget);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.85);
    directionalLight.position.set(1.0, 1.2, 1.0).normalize();
    this.scene.add(directionalLight);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  }

  setup(canvas: HTMLCanvasElement) {
    const parent = canvas.parentElement;
    if (!parent) return;

    const width = parent.clientWidth;
    const height = parent.clientHeight;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(width, height);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(22, width / height, 0.1, 30);
    this.camera.position.set(0, 1.35, 1.8);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.25, 0);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 0.8;
    this.controls.maxDistance = 3.0;
    this.controls.update();

    this.start();
  }

  async loadVrm(url: string) {
    if (!this.camera) return;
    if (this.model?.vrm) {
      this.scene.remove(this.model.vrm.scene);
      this.model.unload();
    }

    this.model = new Model(this.camera);
    await this.model.loadVRM(url);

    if (!this.model?.vrm) return;
    this.model.vrm.scene.traverse((obj) => {
      obj.frustumCulled = false;
    });
    this.model.vrm.scene.rotation.y += 0.08;
    this.scene.add(this.model.vrm.scene);
  }

  resize() {
    if (!this.renderer || !this.camera) return;
    const parent = this.renderer.domElement.parentElement;
    if (!parent) return;
    const width = parent.clientWidth;
    const height = parent.clientHeight;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private start() {
    const tick = () => {
      const delta = this.clock.getDelta();
      this.model?.update(delta);
      this.controls?.update();
      if (this.renderer && this.camera) {
        this.renderer.render(this.scene, this.camera);
      }
      this.raf = window.requestAnimationFrame(tick);
    };
    if (!this.raf) tick();
  }

  dispose() {
    if (this.raf) window.cancelAnimationFrame(this.raf);
    this.controls?.dispose();
    if (this.model?.vrm) {
      this.scene.remove(this.model.vrm.scene);
      this.model.unload();
    }
    this.renderer?.dispose();
  }
}

export default function DigitalHumanModule() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const [tips, setTips] = useState("拖拽或上传 VRM 文件，即可启用数字人。");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const viewer = new Viewer();
    viewerRef.current = viewer;
    viewer.setup(canvas);

    const onResize = () => viewer.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      viewer.dispose();
      viewerRef.current = null;
    };
  }, []);

  const loadByFile = useCallback(async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "vrm") {
      setTips("仅支持 .vrm 文件。");
      return;
    }
    const blob = new Blob([file], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    try {
      setTips("模型加载中，请稍候...");
      await viewerRef.current?.loadVrm(url);
      setTips(`已加载：${file.name}`);
    } catch (e: any) {
      setTips(e?.message ? `加载失败：${e.message}` : "加载失败，请更换模型重试。");
    }
  }, []);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div
        style={{
          height: "520px",
          borderRadius: "16px",
          border: "1px dashed var(--border)",
          background: "linear-gradient(135deg, rgba(180,83,9,.10), rgba(124,45,18,.06))",
          overflow: "hidden",
          position: "relative",
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file) void loadByFile(file);
        }}
      >
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label className="btn" style={{ display: "inline-flex", gap: 8 }}>
          上传 VRM
          <input
            type="file"
            accept=".vrm,model/vrm"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void loadByFile(f);
            }}
          />
        </label>
        <span className="muted" style={{ fontSize: 13 }}>
          {tips}
        </span>
      </div>
    </div>
  );
}

