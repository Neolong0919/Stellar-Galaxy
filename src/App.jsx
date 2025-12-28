import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

// --- 最终定稿版：漩涡喷发-边缘呼吸星系着色器 ---

const stellarVertexShader = `
  uniform float uTime;
  uniform float uFormation;      // 0.0 (漩涡态) -> 1.0 (融合态)
  uniform float uMorph;          // 0.0 (图1) -> 1.0 (图2)
  uniform float uAudioLow;    
  uniform float uAudioMid;    
  uniform float uAudioHigh;   
  uniform float uAudioLevel;  
  uniform float uEnvRotation; 
  
  attribute float size;
  attribute vec3 customColor;
  attribute vec3 customColor2;    // 图2颜色
  attribute float dispersion;
  attribute float starType;
  attribute float twinkleSpeed; 
  attribute float isRing;         
  attribute float isLarge;
  attribute vec3 aRandomDir; 
  attribute float aBrightness;    
  attribute vec3 position2;       // 图2位置
  
  varying vec3 vColor;
  varying float vAlpha;
  varying float vStarType;
  varying float vTwinkle;

  // GLSL 插值
  float easeInOutCubic(float t) {
    return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
  }

  // 二维旋转
  vec2 rotate(vec2 v, float a) {
    float s = sin(a);
    float c = cos(a);
    return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
  }

  void main() {
    vStarType = starType;
    
    // 基础闪烁 + 音乐高频影响
    float speedBoost = 1.0 + uAudioHigh * 3.0;
    float noise = sin(uTime * (1.5 + twinkleSpeed * 2.0) * speedBoost + twinkleSpeed * 100.0);
    float twinkle = noise * 0.5 + 0.5;
    vTwinkle = twinkle;

    // --- 粒子插值内核 ---
    // 基础目标位置与颜色随 uMorph 切换
    vec3 baseTargetPos = mix(position, position2, uMorph);
    vec3 baseColor = mix(customColor, customColor2, uMorph);

    vec3 targetPos = baseTargetPos;
    
    // [主体逻辑 - 结构锁定] 
    // 仅保留 Z 轴 (深度方向) 的微弱呼吸，XY 轴绝对静止，确保主体清晰
    if (isRing < 0.5 && dispersion < 0.1) {
       float wiggleAmp = 0.1 + uAudioLow * 0.2; 
       float wiggle = uTime * 0.8 + twinkleSpeed * 10.0;
       
       vec3 dir = normalize(baseTargetPos);
       targetPos += dir * uAudioLow * 1.0; 
       targetPos.z += sin(wiggle) * wiggleAmp;
    }

    // [边缘柔化飘散]
    if (isRing < 0.5 && dispersion < 0.1) {
        float edgeSoftness = (1.3 - aBrightness); 
        float musicDrift = 1.0 + uAudioLevel * 2.0;
        vec3 drift = aRandomDir * edgeSoftness * sin(uTime * 0.4 + twinkleSpeed * 5.0) * 0.4 * musicDrift;
        targetPos += drift;
    }

    // --- 2. 计算初始漩涡形态 (Vortex State) ---
    // 初始状态：所有粒子都在底部旋转
    float startRadius = 8.0 + dispersion * 45.0; 
    float vortexSpeed = uTime * (0.1 + (0.5 / (startRadius * 0.05 + 0.1))); 
    vortexSpeed += uAudioLow * 0.02; 
    
    float startAngle = twinkleSpeed * 6.28 + vortexSpeed;
    
    // 初始位置压低
    float vortexY = -35.0 + sin(uTime * 1.2 + startRadius * 0.4) * 2.0;
    vec3 vortexPos = vec3(cos(startAngle) * startRadius, vortexY, sin(startAngle) * startRadius);


    // --- 3. 演化插值 ---
    float individualProgress = clamp((uFormation - twinkleSpeed * 0.3) / 0.7, 0.0, 1.0);
    float t = easeInOutCubic(individualProgress);
    
    vec3 currentPos;
    float alphaOut = 1.0; 
    vec3 outColor;

    if (isRing > 0.5) {
        // [底部吸积盘] - 始终保持旋转
        float ringRadius = length(baseTargetPos.xz);
        float ringSpeed = uTime * 0.08 + uAudioLow * 0.02; 
        float currentRingAngle = atan(baseTargetPos.z, baseTargetPos.x) + ringSpeed;
        
        // 音乐均衡器效果
        float waveLow = sin(currentRingAngle * 6.0 + uTime * 2.0); 
        float waveHigh = sin(currentRingAngle * 20.0 - uTime * 5.0);
        float equalizer = abs(waveLow) * uAudioLow * 4.0 + abs(waveHigh) * uAudioHigh * 1.5;
        
        float lift = -30.0 + uFormation * 5.0;
        float finalY = lift + sin(uTime * 0.8 + ringRadius * 0.5) * 1.5 + equalizer;
        
        currentPos = vec3(cos(currentRingAngle) * ringRadius, finalY, sin(currentRingAngle) * ringRadius);
        
        // 吸积盘颜色混合主体色
        outColor = mix(vec3(0.9, 0.95, 1.0), baseColor, uFormation * 0.6);
        outColor += vec3(uAudioLow * 0.4, uAudioHigh * 0.2, 0.0); 
        alphaOut = 1.0; 
        outColor *= 1.5; // 增强漩涡亮度
    } 
    else if (dispersion > 0.1) {
        // [周围氛围粒子] - 弥散立体盘旋
        // 使用用户对齐的角度逻辑
        float envRadius = length(baseTargetPos.xz); 
        float envAngle = atan(baseTargetPos.z, baseTargetPos.x) + uTime * (uEnvRotation * 0.5); 
        vec3 orbitPos = vec3(cos(envAngle) * envRadius, baseTargetPos.y, sin(envAngle) * envRadius);
        
        // 核心修复：出生点设为弥散随机区域 (vortexPos + 大随机偏移)，既不形成螺旋线条，也不形成中心竖线
        vec3 spawnOrigin = vortexPos + aRandomDir * (15.0 + twinkleSpeed * 10.0); 
        currentPos = mix(spawnOrigin, orbitPos, t);
        
        alphaOut = mix(0.0, 0.35 + twinkle * 0.4, t); 
        outColor = baseColor;
    } 
    else {
        // [主体粒子] - 垂直喷发 + 边缘喷发特效
        vec3 midPos = mix(vortexPos, targetPos, t);
        
        // 喷发过程中的湍流只在 t < 0.9 时生效，归位后完全消失
        if(t < 0.9) {
            float turbulence = (1.0 - t) * 1.5; 
            midPos.x += sin(uTime * 5.0 + baseTargetPos.y) * turbulence;
            midPos.z += cos(uTime * 4.0 + baseTargetPos.y) * turbulence;
        } else {
            // 成型后的边缘喷发
            float edgeFactor = 1.0 - smoothstep(0.0, 0.95, aBrightness);
            if (edgeFactor > 0.05) {
                float sprayCycle = fract(uTime * 0.4 + twinkleSpeed * 20.0);
                vec3 sprayDir = normalize(aRandomDir + vec3(0.0, 0.3, 0.0));
                // 音乐增强喷发
                vec3 drift = sprayDir * (0.5 + edgeFactor * 4.5) * sprayCycle * (1.0 + uAudioLow * 0.8);
                midPos += drift;
                alphaOut *= (1.0 - sprayCycle * 0.8);
            }
        }
        
        currentPos = midPos;
        
        float baseAlpha = mix(0.0, 0.4 + twinkle * 0.6, t);
        if (aBrightness < 0.3) baseAlpha *= 0.7; 
        
        if (t > 0.9 && (1.0 - smoothstep(0.0, 0.95, aBrightness)) > 0.05) {
             alphaOut = baseAlpha * alphaOut; 
        } else {
             alphaOut = baseAlpha;
        }
        
        outColor = mix(vec3(0.5, 0.7, 1.0), baseColor, t);
    }

    vec4 mvPosition = modelViewMatrix * vec4(currentPos, 1.0);
    
    float finalSize = size;
    if(isLarge > 0.5) finalSize *= 3.0; 
    if(isRing > 0.5) finalSize *= 1.3; 
    
    // 音乐让粒子脉动
    float beatPulse = 1.0 + uAudioLow * 0.3;
    
    gl_PointSize = finalSize * beatPulse * (1300.0 / -mvPosition.z) * (0.85 + twinkle * 0.15);
    gl_Position = projectionMatrix * mvPosition;
    
    vColor = outColor;
    vAlpha = alphaOut;
  }
`;

const stellarFragmentShader = `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vStarType;
  varying float vTwinkle;
  
  uniform float uAudioHigh;
  uniform float uSaturation;
  uniform float uBrightness;
  uniform float uContrast;
  uniform float uTwinkleStrength;

  void main() {
    vec2 cxy = 2.0 * gl_PointCoord - 1.0;
    float r = dot(cxy, cxy);
    if (r > 1.0) discard;

    float strength = pow(1.0 - r, 10.0);
    float beam = 0.0;
    
    if (vStarType < 0.15 && vAlpha > 0.6) {
        beam = max(0.0, 1.0 - abs(cxy.x) * 20.0) * max(0.0, 1.0 - abs(cxy.y) * 5.0);
        beam += max(0.0, 1.0 - abs(cxy.y) * 20.0) * max(0.0, 1.0 - abs(cxy.x) * 5.0);
    } 
    
    float halo = exp(-r * 6.5) * 0.18;
    
    // 颜色修复：使用可调节参数
    // 饱和度增强
    float maxComponent = max(max(vColor.r, vColor.g), vColor.b);
    float minComponent = min(min(vColor.r, vColor.g), vColor.b);
    vec3 saturatedColor = vColor + (vColor - vec3((maxComponent + minComponent) * 0.5)) * uSaturation;
    
    // 对比度增强
    vec3 contrastedColor = (saturatedColor - 0.5) * uContrast + 0.5;
    
    vec3 baseColor = contrastedColor * (uBrightness + vTwinkle * uTwinkleStrength);
    vec3 coreGlow = contrastedColor * strength * 1.2; 
    vec3 audioFlash = contrastedColor * uAudioHigh * 0.2;

    vec3 finalColor = baseColor + coreGlow + vec3(beam) + audioFlash;
    
    gl_FragColor = vec4(finalColor, (strength + halo) * vAlpha);
  }
`;

export default function App() {
  const containerRef = useRef(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [nebulaInfo, setNebulaInfo] = useState(null);
  const [nebulaInfo2, setNebulaInfo2] = useState(null);
  const [audioData, setAudioData] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  // 新增：可调节参数
  const [saturation, setSaturation] = useState(0.5);      // 饱和度 0-1
  const [brightness, setBrightness] = useState(1.1);      // 亮度 0.5-2
  const [contrast, setContrast] = useState(1.2);          // 对比度 0.5-2
  const [twinkleStrength, setTwinkleStrength] = useState(0.3); // 闪烁强度 0-1
  const [morph, setMorph] = useState(0.0);                // 变形成交 0-1
  const [isAutoCycle, setIsAutoCycle] = useState(true);   // 默认开启自动流转
  const [timeLeft, setTimeLeft] = useState(0);            // 倒计时
  const [isMorphing, setIsMorphing] = useState(false);    // 是否正在形变中
  const [gallery, setGallery] = useState([]);             // 存储已处理的图片数据 {pos, col, name, mainColor, thumb}
  const [currentIdx, setCurrentIdx] = useState(0);        // 当前显示的索引
  const [envRotation, setEnvRotation] = useState(0.1);    // 氛围旋转速度
  const [showControls, setShowControls] = useState(true); // 显示/隐藏控制面板

  const sceneRef = useRef(null);
  const audioRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);

  // 使用 ref 保存最新的参数值，供动画循环使用
  const paramsRef = useRef({ saturation, brightness, contrast, twinkleStrength, morph, envRotation });

  // 每次参数变化时更新 ref
  useEffect(() => {
    paramsRef.current = { saturation, brightness, contrast, twinkleStrength, morph, envRotation };
  }, [saturation, brightness, contrast, twinkleStrength, morph, envRotation]);

  useEffect(() => {
    console.log('useEffect 被调用');
    if (!containerRef.current) {
      console.error('containerRef.current 为空');
      return;
    }
    console.log('containerRef 存在，开始初始化 Three.js');

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#000001');
    console.log('Three.js 场景创建完成');

    const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 1, 10000);
    camera.position.set(0, 30, 130);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.current.appendChild(renderer.domElement);
    console.log('Canvas 已添加到 DOM');
    console.log('Canvas 尺寸:', renderer.domElement.width, 'x', renderer.domElement.height);
    console.log('Canvas style:', renderer.domElement.style.cssText);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.2, 0.4, 0.2));

    const clock = new THREE.Clock();
    sceneRef.current = { scene, camera, renderer, composer, constellation: null, controls, clock, startTime: -1 };
    console.log('初始化完成，开始动画循环');

    let frameCount = 0;
    const animate = () => {
      requestAnimationFrame(animate);
      frameCount++;
      if (frameCount === 1) console.log('动画循环已启动');

      let bass = 0.0;
      let mid = 0.0;
      let treble = 0.0;
      let level = 0.0;

      if (audioRef.current && audioRef.current.analyser && !audioRef.current.audio.paused) {
        const analyser = audioRef.current.analyser;
        const dataArray = audioRef.current.dataArray;
        analyser.getByteFrequencyData(dataArray);

        const binCount = analyser.frequencyBinCount;
        const bassLimit = Math.floor(binCount * 0.1);
        let bassSum = 0;
        for (let i = 0; i < bassLimit; i++) bassSum += dataArray[i];
        bass = (bassSum / bassLimit) / 255.0;

        const midEnd = Math.floor(binCount * 0.40);
        let midSum = 0;
        for (let i = bassLimit; i < midEnd; i++) midSum += dataArray[i];
        mid = (midSum / (midEnd - bassLimit)) / 255.0;

        let trebleSum = 0;
        for (let i = midEnd; i < binCount; i++) trebleSum += dataArray[i];
        treble = (trebleSum / (binCount - midEnd)) / 255.0;

        level = (bass + mid + treble) / 3.0;
      }

      if (sceneRef.current) {
        const { constellation, composer, clock, startTime, controls } = sceneRef.current;
        const time = clock.getElapsedTime();

        if (constellation && constellation.material.uniforms) {
          const m = constellation.material;
          m.uniforms.uTime.value = time;

          // 实时更新可调节参数（从 ref 中获取最新值）
          const params = paramsRef.current;
          m.uniforms.uSaturation.value = params.saturation;
          m.uniforms.uBrightness.value = params.brightness;
          m.uniforms.uContrast.value = params.contrast;
          m.uniforms.uTwinkleStrength.value = params.twinkleStrength;
          m.uniforms.uMorph.value = params.morph;
          m.uniforms.uEnvRotation.value = params.envRotation;

          m.uniforms.uAudioLow.value = THREE.MathUtils.lerp(m.uniforms.uAudioLow.value, bass, 0.4);
          m.uniforms.uAudioMid.value = THREE.MathUtils.lerp(m.uniforms.uAudioMid.value, mid, 0.3);
          m.uniforms.uAudioHigh.value = THREE.MathUtils.lerp(m.uniforms.uAudioHigh.value, treble, 0.5);
          m.uniforms.uAudioLevel.value = THREE.MathUtils.lerp(m.uniforms.uAudioLevel.value, level, 0.3);

          if (startTime > 0) {
            const dt = time - startTime;
            if (dt < 2.0) {
              m.uniforms.uFormation.value = 0.0;
            } else if (dt < 9.0) {
              const progress = (dt - 2.0) / 7.0;
              m.uniforms.uFormation.value = progress;
            } else {
              m.uniforms.uFormation.value = 1.0;
            }
          }
        }
        controls.update();
        composer.render();
      }
    };
    animate();

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      composer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (audioRef.current) {
        audioRef.current.audio.pause();
        if (audioRef.current.context.state !== 'closed') {
          audioRef.current.context.close();
        }
      }
      renderer.dispose();
    };
  }, []);

  const toggleRecording = () => {
    if (isRecording) {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      setIsRecording(false);
    } else {
      const canvas = sceneRef.current.renderer.domElement;
      const stream = canvas.captureStream(60);
      let mimeType = 'video/mp4';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm;codecs=vp9';
      if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm';

      const options = { mimeType: mimeType, videoBitsPerSecond: 8000000 };
      const recorder = new MediaRecorder(stream, options);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const a = document.createElement('a');
        a.href = url;
        const timestamp = Date.now();
        a.download = 'stellar_galaxy_' + timestamp + '.' + ext;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      };

      recorder.start();
      recorderRef.current = recorder;
      setIsRecording(true);
    }
  };

  const handleMusicUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (audioRef.current) {
      audioRef.current.audio.pause();
      audioRef.current.audio.src = "";
      if (audioRef.current.context.state !== 'closed') {
        audioRef.current.context.close();
      }
      audioRef.current = null;
    }

    const url = URL.createObjectURL(file);
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const audio = new Audio();
    audio.src = url;
    audio.loop = true;
    audio.crossOrigin = "anonymous";

    const source = ctx.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(ctx.destination);

    audio.play();
    setIsPlaying(true);

    audioRef.current = {
      audio,
      context: ctx,
      analyser,
      dataArray
    };

    setAudioData({ name: file.name });
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.audio.pause();
    } else {
      audioRef.current.audio.play();
    }
    setIsPlaying(!isPlaying);
  };

  // 核心工具：将 BufferAttribute 从目标(Slot 2) 物理转移到 起始(Slot 1)
  // JS 插值函数
  const easeInOutCubic = (t) => {
    return t < 0.5 ? 4.0 * t * t * t : 1.0 - Math.pow(-2.0 * t + 2.0, 3.0) / 2.0;
  };

  const promoteTargetToSource = () => {
    if (!sceneRef.current || !sceneRef.current.constellation) return;
    const geo = sceneRef.current.constellation.geometry;

    // 把目前的 position2 复制给 position (作为新的起点)
    const pos2 = geo.attributes.position2.array;
    geo.attributes.position.array.set(pos2);
    geo.attributes.position.needsUpdate = true;

    const col2 = geo.attributes.customColor2.array;
    geo.attributes.customColor.array.set(col2);
    geo.attributes.customColor.needsUpdate = true;

    setMorph(0); // 重置形变进度
  };

  const processImage = async (file, slot = 1, silent = false) => {
    if (!silent && slot === 1) setIsProcessing(true);

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const img = new Image();
          img.src = e.target.result;
          await img.decode();

          const aspect = img.width / img.height;
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const res = 260;
          canvas.width = res; canvas.height = Math.floor(res / aspect);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const pixelData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

          const MAX_PARTICLES = 60000;
          const pos = new Float32Array(MAX_PARTICLES * 3);
          const col = new Float32Array(MAX_PARTICLES * 3);

          let tr = 0, tg = 0, tb = 0, tc = 0;
          const spreadScale = 60;
          const spreadX = spreadScale * aspect;
          const spreadY = spreadScale;

          let subIdx = 0;
          let auraIdx = 45000;
          const SUBJECT_LIMIT = 45000;
          const AURA_LIMIT = 57600;

          for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
              const idx = (y * canvas.width + x) * 4;
              const r = pixelData[idx] / 255, g = pixelData[idx + 1] / 255, b = pixelData[idx + 2] / 255;
              const br = (r + g + b) / 3;

              if (br > 0.06) {
                tr += r; tg += g; tb += b; tc++;

                // 1. 填充主体像素 (0 - 45000)
                if (subIdx < SUBJECT_LIMIT) {
                  const px = (x / canvas.width - 0.5) * spreadX;
                  const py = (0.5 - y / canvas.height) * spreadY;
                  const pz = (br - 0.5) * 10.0;
                  const i3 = subIdx * 3;
                  pos[i3] = px; pos[i3 + 1] = py; pos[i3 + 2] = pz;
                  col[i3] = r; col[i3 + 1] = g; col[i3 + 2] = b;
                  subIdx++;
                }

                // 2. 填充氛围粒子 (45000 - 57600)
                if (Math.random() > 0.85 && auraIdx < AURA_LIMIT) {
                  const angle = Math.random() * Math.PI * 2;
                  const radius = spreadX * (0.5 + Math.random() * 0.8);
                  const envX = Math.cos(angle) * radius;
                  const envY = (Math.random() - 0.5) * spreadY * 2.5;
                  const envZ = Math.sin(angle) * radius;
                  const e3 = auraIdx * 3;
                  pos[e3] = envX; pos[e3 + 1] = envY; pos[e3 + 2] = envZ;
                  col[e3] = r * 0.85; col[e3 + 1] = g * 0.85; col[e3 + 2] = b * 0.85;
                  auraIdx++;
                }
              }
            }
          }

          // 3. 冗余填充 (确保数组填满)
          const activeSubCount = subIdx || 1;
          while (subIdx < SUBJECT_LIMIT) {
            const src = Math.floor(Math.random() * activeSubCount) * 3;
            const i3 = subIdx * 3;
            pos[i3] = pos[src]; pos[i3 + 1] = pos[src + 1]; pos[i3 + 2] = pos[src + 2];
            col[i3] = col[src]; col[i3 + 1] = col[src + 1]; col[i3 + 2] = col[src + 2];
            subIdx++;
          }
          while (auraIdx < AURA_LIMIT) {
            const src = Math.floor(Math.random() * (subIdx || 1)) * 3;
            const angle = Math.random() * Math.PI * 2;
            const radius = spreadX * (0.6 + Math.random() * 0.9); // 确保有足够半径
            const i3 = auraIdx * 3;
            pos[i3] = Math.cos(angle) * radius;
            pos[i3 + 1] = (Math.random() - 0.5) * spreadY * 2.5;
            pos[i3 + 2] = Math.sin(angle) * radius;
            col[i3] = col[src] * 0.85; col[i3 + 1] = col[src + 1] * 0.85; col[i3 + 2] = col[src + 2] * 0.85;
            auraIdx++;
          }

          let pIdx = 57600;

          // 2. 螺旋吸积盘 (还原漩涡逻辑)
          const spiralArms = 3;
          const particlesPerArm = 800;
          const ringRadiusBase = spreadX * 0.8;

          for (let arm = 0; arm < spiralArms; arm++) {
            for (let i = 0; i < particlesPerArm; i++) {
              const t = i / particlesPerArm;
              const angleOffset = (Math.PI * 2 / spiralArms) * arm;
              // 使用确定性的角度计算，防止多图变换时漩涡因为随机角度不同而坍缩
              const spiralAngle = angleOffset + t * Math.PI * 3.0;
              const r = ringRadiusBase * (0.1 + t * 0.9);
              // 使用确定性的随机 (基于 i)
              const seed = (arm * particlesPerArm + i) * 1.5;
              const deterministicRandom = (Math.sin(seed) * 0.5 + 0.5);
              const spread = (deterministicRandom - 0.5) * (15.0 * t + 2.0);
              const finalR = r + spread;
              const finalAngle = spiralAngle;

              const i3 = pIdx * 3;
              pos[i3] = Math.cos(finalAngle) * finalR;
              pos[i3 + 1] = -spreadY * 0.55 + (deterministicRandom - 0.5) * 2.0;
              pos[i3 + 2] = Math.sin(finalAngle) * finalR;

              const mixFactor = t;
              col[i3] = Math.min(1.0, 1.0 * (1.0 - mixFactor) + (tr / tc + 0.2) * mixFactor);
              col[i3 + 1] = Math.min(1.0, 1.0 * (1.0 - mixFactor) + (tg / tc + 0.2) * mixFactor);
              col[i3 + 2] = Math.min(1.0, 1.0 * (1.0 - mixFactor) + (tb / tc + 0.2) * mixFactor);
              pIdx++;
            }
          }
          const avgR = tc > 0 ? Math.round(tr / tc * 255) : 127;
          const avgG = tc > 0 ? Math.round(tg / tc * 255) : 127;
          const avgB = tc > 0 ? Math.round(tb / tc * 255) : 127;
          const mainColor = `#${avgR.toString(16).padStart(2, '0')}${avgG.toString(16).padStart(2, '0')}${avgB.toString(16).padStart(2, '0')}`;

          // 生成缩略图
          const thumbCanvas = document.createElement('canvas');
          thumbCanvas.width = 64; thumbCanvas.height = 64;
          const tCtx = thumbCanvas.getContext('2d');
          tCtx.drawImage(img, 0, 0, 64, 64);
          const thumb = thumbCanvas.toDataURL('image/jpeg', 0.7);

          const result = { pos, col, mainColor, name: file.name, thumb };
          resolve(result);
        } catch (err) { reject(err); }
      };
      reader.readAsDataURL(file);
    });
  };

  const handleMultiUpload = async (e, isGalleryOnly = false) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    if (!isGalleryOnly) setIsProcessing(true);

    const results = [];
    for (const file of files) {
      try {
        const data = await processImage(file, 1, true);
        results.push(data);
      } catch (err) { console.error("处理失败:", file.name, err); }
    }

    if (!isGalleryOnly && results.length > 0) {
      // 第一张作为初始形态
      const first = results[0];
      setNebulaInfo({ name: first.name, lore: "创世基底已确立。", mainColor: first.mainColor });

      // 特殊初始化 BufferGeometry
      // (这里复用之前的初始化逻辑，但使用结果 data)
      initConstellation(first);

      // 其余加入图库
      setGallery(prev => [...prev, ...results]);
      setCurrentIdx(0); // 重置索引到第一张
    } else {
      setGallery(prev => [...prev, ...results]);
    }

    setIsProcessing(false);
    if (!isGalleryOnly && results.length > 1) {
      setTimeLeft(3); // 启动创世后立即开启首轮倒计时
    }
  };

  const initConstellation = (data) => {
    // 完整初始化 BufferGeometry 的逻辑 (只需调用一次)
    const MAX_PARTICLES = 60000;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.pos, 3));
    geometry.setAttribute('customColor', new THREE.BufferAttribute(data.col, 3));

    // 其他随机属性
    const siz = new Float32Array(MAX_PARTICLES).map(() => 0.1 + Math.random() * 0.3);
    const disp = new Float32Array(MAX_PARTICLES).fill(0);
    // 45000 - 57600 为氛围粒子，标记高 dispersion 触发氛围逻辑
    for (let i = 45000; i < 57600; i++) disp[i] = 1.0;

    const twin = new Float32Array(MAX_PARTICLES).map(() => Math.random());
    const ring = new Float32Array(MAX_PARTICLES).fill(0);
    // 57600 - 60000 标记为漩涡环
    for (let i = 57600; i < MAX_PARTICLES; i++) ring[i] = 1.0;

    const large = new Float32Array(MAX_PARTICLES).map(() => Math.random() > 0.95 ? 1.0 : 0.0);
    const rndDir = new Float32Array(MAX_PARTICLES * 3).map(() => Math.random() - 0.5);
    const brights = new Float32Array(MAX_PARTICLES).fill(0.8);
    const stars = new Float32Array(MAX_PARTICLES).fill(0);

    geometry.setAttribute('size', new THREE.BufferAttribute(siz, 1));
    geometry.setAttribute('dispersion', new THREE.BufferAttribute(disp, 1));
    geometry.setAttribute('twinkleSpeed', new THREE.BufferAttribute(twin, 1));
    geometry.setAttribute('isRing', new THREE.BufferAttribute(ring, 1));
    geometry.setAttribute('isLarge', new THREE.BufferAttribute(large, 1));
    geometry.setAttribute('aRandomDir', new THREE.BufferAttribute(rndDir, 3));
    geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brights, 1));
    geometry.setAttribute('starType', new THREE.BufferAttribute(stars, 1));

    geometry.setAttribute('position2', new THREE.BufferAttribute(new Float32Array(data.pos), 3));
    geometry.setAttribute('customColor2', new THREE.BufferAttribute(new Float32Array(data.col), 3));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uFormation: { value: 1.0 }, uMorph: { value: 0 },
        uAudioLow: { value: 0.0 }, uAudioMid: { value: 0.0 }, uAudioHigh: { value: 0.0 }, uAudioLevel: { value: 0.0 },
        uSaturation: { value: 0.5 }, uBrightness: { value: 1.1 }, uContrast: { value: 1.2 }, uTwinkleStrength: { value: 0.3 },
        uEnvRotation: { value: 0.1 }
      },
      vertexShader: stellarVertexShader,
      fragmentShader: stellarFragmentShader,
      blending: THREE.AdditiveBlending, depthTest: false, transparent: true
    });

    if (sceneRef.current) {
      const { scene, constellation, clock, controls } = sceneRef.current;
      if (constellation) scene.remove(constellation);
      const newConstellation = new THREE.Points(geometry, material);
      scene.add(newConstellation);
      sceneRef.current.constellation = newConstellation;
      sceneRef.current.startTime = clock.getElapsedTime();
    }
  };

  const triggerNextMorph = (targetItem = null) => {
    if (gallery.length === 0 || isMorphing) return;

    let targetIdx;
    let nextItem;

    if (targetItem) {
      targetIdx = gallery.findIndex(item => item === targetItem);
      if (targetIdx === -1) targetIdx = gallery.findIndex(item => item.name === targetItem.name);
      if (targetIdx === -1) return;
      nextItem = gallery[targetIdx];
    } else {
      // 核心：使用函数式更新来获取最新索引，但把逻辑移出 setter 以避免副作用冲突
      // 为了稳定，我们直接根据当前的 currentIdx 计算
      targetIdx = (currentIdx + 1) % gallery.length;
      nextItem = gallery[targetIdx];
    }

    if (!nextItem) return;

    console.log(`[形态引擎] 物理跃迁: ${currentIdx} -> ${targetIdx} / ${gallery.length}`);

    // 1. 设置索引
    setCurrentIdx(targetIdx);

    // 2. 执行物理迁移
    promoteTargetToSource();

    if (sceneRef.current && sceneRef.current.constellation) {
      const geo = sceneRef.current.constellation.geometry;
      geo.attributes.position2.array.set(nextItem.pos);
      geo.attributes.position2.needsUpdate = true;
      geo.attributes.customColor2.array.set(nextItem.col);
      geo.attributes.customColor2.needsUpdate = true;

      setNebulaInfo2({ name: nextItem.name, lore: "形态跃迁中，粒子坐标正在重新定向...", mainColor: nextItem.mainColor });
      setNebulaInfo({ name: nextItem.name, lore: "能量在图库间共鸣，粒子流向新的形态。", mainColor: nextItem.mainColor });

      setTimeLeft(3);
      startMorphEvolution();
    }
  };

  const startMorphEvolution = () => {
    setIsMorphing(true);
    let startTimestamp = null;
    const duration = 6000;

    const step = (timestamp) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      const ease = easeInOutCubic(progress);
      setMorph(ease);

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        setIsMorphing(false);
      }
    };
    requestAnimationFrame(step);
  };

  // 优化的自动流转逻辑
  useEffect(() => {
    if (!isAutoCycle || isMorphing || gallery.length <= 1) return;

    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          // 这里不再直接调用 triggerNextMorph，避免 setter 冲突
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isAutoCycle, isMorphing, gallery.length]);

  // 独立监听 timeLeft，当到 0 时触发跃迁
  useEffect(() => {
    if (isAutoCycle && !isMorphing && timeLeft === 0 && gallery.length > 1) {
      triggerNextMorph();
    }
  }, [timeLeft, isAutoCycle, isMorphing]);

  return (
    <div className="relative w-full h-screen bg-[#000001] overflow-hidden text-white font-sans">
      <div ref={containerRef} className="absolute inset-0 z-0" />
      <div className="absolute inset-0 pointer-events-none z-10 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.6)_100%)]" />

      {/* 左上角控制面板 */}
      {showControls && nebulaInfo && (
        <div className="absolute top-6 left-6 w-80 p-6 bg-black/70 backdrop-blur-2xl border border-white/10 rounded-3xl pointer-events-auto z-30">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-light tracking-widest uppercase text-blue-200">可视化控制</h3>
            <button onClick={() => setShowControls(false)} className="text-white/50 hover:text-white text-xs">×</button>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center py-2 px-4 bg-blue-500/10 rounded-xl border border-blue-500/20">
              <span className="text-[10px] text-blue-300 uppercase tracking-widest font-medium">下一次跃迁</span>
              <span className="text-xs text-blue-400 font-mono font-bold animate-pulse">{timeLeft}s</span>
            </div>

            <div className="h-[1px] w-full bg-white/5 my-2" />

            <div className="relative">
              <div className="flex justify-between items-center mb-3">
                <label className="text-[10px] text-white/40 uppercase tracking-tight font-light">图库阵列 ({gallery.length})</label>
                <label className="text-[9px] text-blue-400 cursor-pointer hover:underline">
                  <input type="file" accept="image/*" multiple onChange={(e) => handleMultiUpload(e, true)} className="hidden" />
                  + 扩充
                </label>
              </div>

              <div className="flex gap-2 overflow-x-auto pb-4 no-scrollbar scroll-smooth group/gallery">
                {gallery.map((item, idx) => (
                  <div
                    key={idx}
                    onClick={() => triggerNextMorph(item)}
                    className="relative flex-shrink-0 w-16 h-16 rounded-xl border border-white/10 overflow-hidden cursor-pointer transition-all duration-300 hover:scale-110 hover:-translate-y-1 hover:border-blue-500/50 group/card"
                  >
                    <img src={item.thumb} alt={item.name} className="w-full h-full object-cover opacity-60 group-hover/card:opacity-100 transition-opacity" />
                    {currentIdx === idx && (
                      <div className="absolute inset-0 bg-blue-500/20 flex items-center justify-center">
                        <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="h-[1px] w-full bg-white/5 my-2" />

            <div>
              <label className="text-[10px] text-blue-300 tracking-wider uppercase block mb-2">星云旋转: {envRotation.toFixed(2)}</label>
              <input type="range" min="0" max="1" step="0.01" value={envRotation} onChange={(e) => setEnvRotation(parseFloat(e.target.value))} className="w-full h-1 bg-blue-500/20 rounded-lg appearance-none cursor-pointer" />
            </div>

            <div>
              <label className="text-[10px] text-white/60 tracking-wider uppercase block mb-2">饱和度: {saturation.toFixed(2)}</label>
              <input type="range" min="-1" max="3" step="0.01" value={saturation} onChange={(e) => setSaturation(parseFloat(e.target.value))} className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer" />
            </div>

            <div>
              <label className="text-[10px] text-white/60 tracking-wider uppercase block mb-2">亮度: {brightness.toFixed(2)}</label>
              <input type="range" min="-1" max="4" step="0.1" value={brightness} onChange={(e) => setBrightness(parseFloat(e.target.value))} className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer" />
            </div>

            <div>
              <label className="text-[10px] text-white/60 tracking-wider uppercase block mb-2">对比度: {contrast.toFixed(2)}</label>
              <input type="range" min="-1" max="4" step="0.1" value={contrast} onChange={(e) => setContrast(parseFloat(e.target.value))} className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer" />
            </div>

            <div>
              <label className="text-[10px] text-white/60 tracking-wider uppercase block mb-2">闪烁强度: {twinkleStrength.toFixed(2)}</label>
              <input type="range" min="-1" max="3" step="0.05" value={twinkleStrength} onChange={(e) => setTwinkleStrength(parseFloat(e.target.value))} className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer" />
            </div>

            <button
              onClick={() => { setSaturation(0.5); setBrightness(1.1); setContrast(1.2); setTwinkleStrength(0.3); setMorph(0); setIsAutoCycle(false); }}
              className="w-full py-2 text-[9px] tracking-wider uppercase bg-white/5 hover:bg-white/10 border border-white/10 rounded-full transition-all"
            >
              重置参数
            </button>
          </div>
        </div>
      )}

      {!showControls && nebulaInfo && (
        <button onClick={() => setShowControls(true)} className="absolute top-6 left-6 w-10 h-10 bg-black/70 backdrop-blur-2xl border border-white/10 rounded-full flex items-center justify-center pointer-events-auto z-30 hover:bg-white/20 transition-all">⚙️</button>
      )}

      <div className="absolute inset-0 z-20 pointer-events-none flex flex-col items-center justify-center p-6 text-center">
        {!nebulaInfo && !isProcessing && (
          <div className="max-w-xl pointer-events-auto animate-in fade-in zoom-in duration-1000">
            <h1 className="text-5xl font-thin tracking-[1.2em] mb-4 uppercase text-transparent bg-clip-text bg-gradient-to-r from-blue-100 via-white to-blue-400 text-center">STELLAR GALAXY</h1>
            <p className="text-xs font-light tracking-[0.5em] opacity-30 mb-16 uppercase italic text-center">多维流转 · 奇点喷发 · 粒子守恒</p>
            <div className="flex gap-4 pointer-events-auto justify-center">
              <label className="group relative inline-block cursor-pointer">
                <input type="file" accept="audio/*" onChange={handleMusicUpload} className="hidden" />
                <div className="px-8 py-4 border border-white/10 rounded-full bg-white/5 backdrop-blur-xl transition-all duration-300 hover:bg-white hover:text-black hover:border-white">
                  <span className="mr-2">♪</span>
                  <span className="tracking-[0.2em] font-medium text-xs">{audioData ? "更换音乐" : "上传音乐"}</span>
                </div>
              </label>
              <label className="group relative inline-block cursor-pointer">
                <input type="file" accept="image/*" multiple onChange={handleMultiUpload} className="hidden" />
                <div className="px-16 py-4 border border-white/10 rounded-full bg-white/5 backdrop-blur-xl transition-all duration-500 hover:bg-white hover:text-black hover:border-white">
                  <span className="mr-3 opacity-60 group-hover:opacity-100">✦</span>
                  <span className="tracking-[0.4em] font-medium text-xs">启动创世</span>
                </div>
              </label>
            </div>
            {audioData && (
              <div className="mt-6 flex items-center gap-4 pointer-events-auto animate-in fade-in slide-in-from-bottom-4 justify-center">
                <button onClick={togglePlay} className="w-10 h-10 flex items-center justify-center rounded-full border border-white/20 bg-white/5 hover:bg-white/20 transition-all">{isPlaying ? "⏸" : "▶"}</button>
                <div className="text-[10px] opacity-60 tracking-widest uppercase truncate max-w-[200px]">{isPlaying ? "Playing: " : "Paused: "} {audioData.name}</div>
              </div>
            )}
          </div>
        )}

        {isProcessing && (
          <div className="flex flex-col items-center">
            <div className="w-10 h-10 border-2 border-white/10 border-t-blue-500 rounded-full animate-spin mb-6" />
            <p className="text-[10px] tracking-[0.6em] font-light uppercase opacity-40">初始化奇点漩涡...</p>
          </div>
        )}

        {nebulaInfo && !isProcessing && (
          <div className="absolute bottom-10 left-10 max-w-xs w-full p-8 bg-black/60 backdrop-blur-3xl border border-white/5 rounded-[2.5rem] animate-in slide-in-from-left-12 duration-1000 pointer-events-auto text-left">
            <h2 className="text-lg font-light tracking-widest text-blue-100 uppercase leading-tight mb-2">{isMorphing ? (nebulaInfo2?.name || "Target Form") : nebulaInfo.name}</h2>
            <div className="h-[1px] w-full bg-gradient-to-r from-blue-500/30 to-transparent mb-4" />
            <p className="text-[11px] font-light leading-relaxed text-white/50 italic mb-8">{isMorphing ? (nebulaInfo2?.lore || "维度跃入新形态...") : nebulaInfo.lore}</p>

            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                <button className="flex-1 py-3 text-[10px] tracking-[0.2em] uppercase font-bold text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 rounded-full transition-all" onClick={() => { setNebulaInfo(null); setGallery([]); setIsAutoCycle(true); setMorph(0); setTimeLeft(0); setCurrentIdx(0); }}>重置</button>
                <label className="flex-1 py-3 text-[10px] tracking-[0.2em] uppercase font-bold text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 rounded-full cursor-pointer text-center flex items-center justify-center">
                  <input type="file" accept="image/*" multiple onChange={(e) => handleMultiUpload(e, true)} className="hidden" />
                  扩充
                </label>
              </div>
              <label className="w-full py-3 text-[10px] tracking-[0.2em] uppercase font-bold text-white bg-white/5 hover:bg-white/10 border border-white/20 rounded-full cursor-pointer text-center flex items-center justify-center">
                <input type="file" accept="audio/*" onChange={handleMusicUpload} className="hidden" />
                🎵 音乐配置
              </label>
              {audioData && (
                <button className={isPlaying ? 'w-full py-2 text-[10px] tracking-[0.2em] uppercase transition-all border border-white/10 rounded-full bg-blue-500/20 text-blue-200' : 'w-full py-2 text-[10px] tracking-[0.2em] uppercase transition-all border border-white/10 rounded-full bg-white/5 hover:bg-white/10 text-white/50'} onClick={togglePlay}>{isPlaying ? "⏸ 暂停" : "▶ 播放"}</button>
              )}
              <button className={isRecording ? 'w-full py-2 text-[10px] tracking-[0.2em] uppercase transition-all border border-white/10 rounded-full bg-red-500/20 text-red-200 animate-pulse' : 'w-full py-2 text-[10px] tracking-[0.2em] uppercase transition-all border border-white/10 rounded-full bg-white/5 hover:bg-white/10'} onClick={toggleRecording}>{isRecording ? "🔴 停止" : "⭕ 录制"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
