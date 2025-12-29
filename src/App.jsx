import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

// --- 最终定稿版：漩涡喷发-边缘呼吸星系着色器 ---

window.onerror = function (message, source, lineno, colno, error) {
  alert('Error: ' + message + '\nLine: ' + lineno + '\nSource: ' + source);
};

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
  varying float vIsRing;
  varying float vFormation;

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
    
    // 基础闪烁 + 音乐高频影响 (简化计算)
    float twinkle = sin(uTime * (1.5 + twinkleSpeed * 2.0) * (1.0 + uAudioHigh * 3.0) + twinkleSpeed * 100.0) * 0.5 + 0.5;
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
    vIsRing = isRing;
    vFormation = t;
  }
`;

const stellarFragmentShader = `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vStarType;
  varying float vTwinkle;
  varying float vIsRing;
  varying float vFormation;
  
  uniform float uAudioLow;
  uniform float uAudioHigh;
  uniform float uSaturation;
  uniform float uBrightness;
  uniform float uContrast;
  uniform float uTwinkleStrength;

  void main() {
    vec2 cxy = 2.0 * gl_PointCoord - 1.0;
    float r = dot(cxy, cxy);
    if (r > 1.0) discard;

    float strength = (1.0 - r) * (1.0 - r) * (1.0 - r); // 使用简单乘法代替 pow(x, 10.0) 显著提升性能
    strength *= strength * strength; // 约等于 pow(1.0-r, 9.0) 但快得多
    float beam = 0.0;
    
    if (vStarType < 0.15 && vAlpha > 0.6) {
        beam = max(0.0, 1.0 - abs(cxy.x) * 20.0) * max(0.0, 1.0 - abs(cxy.y) * 5.0);
        beam += max(0.0, 1.0 - abs(cxy.y) * 20.0) * max(0.0, 1.0 - abs(cxy.x) * 5.0);
    } 
    
    float halo = exp(-r * 6.5) * 0.15; // 稍微降低光晕复杂度
    
    // 颜色修复：使用可调节参数
    // 饱和度增强
    float maxComponent = max(max(vColor.r, vColor.g), vColor.b);
    float minComponent = min(min(vColor.r, vColor.g), vColor.b);
    vec3 saturatedColor = vColor + (vColor - vec3((maxComponent + minComponent) * 0.5)) * uSaturation;
    
    // 对比度增强
    vec3 contrastedColor = (saturatedColor - 0.5) * uContrast + 0.5;
    
    vec3 baseColor = contrastedColor * (uBrightness + vTwinkle * uTwinkleStrength);
    
    // 律动增强：漩涡亮度随节拍爆发 (vIsRing > 0.5 且 vFormation > 0.8)
    float pulse = 1.0;
    if (vIsRing > 0.5 && vFormation > 0.8) {
        pulse = 1.0 + uAudioLow * 1.5;
    }
    baseColor *= pulse;

    vec3 coreGlow = contrastedColor * strength * 1.2; 
    vec3 audioFlash = contrastedColor * uAudioHigh * 0.2;

    gl_FragColor = vec4(baseColor + coreGlow + audioFlash, (strength + halo) * vAlpha);
  }
`;

// --- 歌词粒子逻辑已由 UI 方案取代 ---

export default function App() {
  const containerRef = useRef(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [nebulaInfo, setNebulaInfo] = useState(null);
  const [nebulaInfo2, setNebulaInfo2] = useState(null);
  const [audioData, setAudioData] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isStarted, setIsStarted] = useState(false);      // 是否已开始创世

  // 新增：可调节参数
  const [saturation, setSaturation] = useState(0.5);      // 饱和度 0-1
  const [brightness, setBrightness] = useState(1.1);      // 亮度 0.5-2
  const [contrast, setContrast] = useState(1.2);          // 对比度 0.5-2
  const [twinkleStrength, setTwinkleStrength] = useState(0.3); // 闪烁强度 0-1
  const [morph, setMorph] = useState(0.0);                // 变形成交 0-1
  const [isAutoCycle, setIsAutoCycle] = useState(true);   // 默认开启自动流转
  const [timeLeft, setTimeLeft] = useState(0);            // 倒计时
  const [isMorphing, setIsMorphing] = useState(false);    // 是否正在形变中
  const [showLyrics, setShowLyrics] = useState(true);     // 是否显示歌词
  const [gallery, setGallery] = useState([]);             // 存储已处理的图片数据 {pos, col, name, mainColor, thumb}
  const [currentIdx, setCurrentIdx] = useState(0);        // 当前显示的索引
  const [envRotation, setEnvRotation] = useState(0.1);    // 氛围旋转速度
  const [showControls, setShowControls] = useState(false); // 默认隐藏控制面板
  const [showMusicPanel, setShowMusicPanel] = useState(false); // 默认隐藏音乐面板
  const [mouseX, setMouseX] = useState(null);             // 鼠标在底栏的 X 坐标
  const [stayDuration, setStayDuration] = useState(3);    // 停留时间 (秒)
  const [morphDuration, setMorphDuration] = useState(6);  // 变换时长 (秒)

  // Netease 音乐相关状态
  const [musicUser, setMusicUser] = useState(null);       // 用户信息
  const [loginQR, setLoginQR] = useState(null);           // 登录二维码 (base64)
  const [cookie, setCookie] = useState('');               // Netease Cookie
  const [playlists, setPlaylists] = useState([]);         // 收藏歌单
  const [currentTrack, setCurrentTrack] = useState(null); // 当前播放歌曲
  const [isMusicLoading, setIsMusicLoading] = useState(false);
  // 核心设定
  const PARTICLE_SIZE = 120;
  const MUSIC_API = "http://localhost:4000";

  // Robust fetch with retry for startup
  const fetchWithRetry = async (url, options = {}, retries = 5, delay = 2000) => {
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(url, options);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res;
      } catch (err) {
        if (i === retries - 1) throw err;
        console.log(`Connection failed, retrying in ${delay}ms... (${i + 1}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  };               // Netease API 端口 (与前端域名保持一致更稳定)

  // 新增功能状态
  const [musicMode, setMusicMode] = useState('playlist'); // 当前模式: playlist, recommend, fm, history
  const [recommendSongs, setRecommendSongs] = useState([]); // 每日推荐歌曲
  const [fmQueue, setFmQueue] = useState([]);             // 私人 FM 队列
  const [historySongs, setHistorySongs] = useState([]);   // 听歌排行 (周)
  const [lyrics, setLyrics] = useState([]);               // 歌词数据 [{time, text}]
  const [currentLyric, setCurrentLyric] = useState("");   // 当前歌词
  const [nextLyric, setNextLyric] = useState("");         // 下一句歌词 (用于预备 morph)

  // 歌词自定义参数
  const [lyricScale, setLyricScale] = useState(1.0);      // 大小
  const [lyricDensity, setLyricDensity] = useState(2);    // 密度 (step: 1非常密 - 5稀疏)
  const [lyricSpeed, setLyricSpeed] = useState(1.0);      // 飘散速度
  const [lyricOffsetY, setLyricOffsetY] = useState(0);    // 上下偏移 (调回 0，配合基准)

  const sceneRef = useRef(null);
  const audioRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const scrollContainerRef = useRef(null); // 新增：滚动容器 Ref
  const scrollScrollInterval = useRef(null); // 新增：滚动定时器 Ref

  // 关键 Ref：确保侧效应始终能拿到最新的状态，解决“第一张/最后一张不循环”的闭连捕获问题
  const currentIdxRef = useRef(0);
  const galleryRef = useRef([]);

  useEffect(() => { currentIdxRef.current = currentIdx; }, [currentIdx]);
  useEffect(() => { galleryRef.current = gallery; }, [gallery]);

  // 使用 ref 保存最新的参数值，供动画循环使用
  const paramsRef = useRef({
    saturation, brightness, contrast, twinkleStrength, morph, envRotation,
    lyricScale, lyricSpeed, lyricOffsetY
  });

  // 每次参数变化时更新 ref
  useEffect(() => {
    paramsRef.current = {
      saturation, brightness, contrast, twinkleStrength, morph, envRotation,
      lyricScale, lyricSpeed, lyricOffsetY
    };
  }, [saturation, brightness, contrast, twinkleStrength, morph, envRotation, lyricScale, lyricSpeed, lyricOffsetY]);

  // --- 登录持久化逻辑 ---
  useEffect(() => {
    const savedCookie = localStorage.getItem('netease_cookie');
    if (savedCookie) {
      setCookie(savedCookie);
      fetchMusicUserInfo(savedCookie);
    }
  }, []);

  // 退出登录
  const handleLogout = () => {
    localStorage.removeItem('netease_cookie');
    setCookie('');
    setMusicUser(null);
    setPlaylists([]);
    setSongList([]);
    setCurrentTrack(null);
    setLyrics([]);
    setCurrentLyric("");
  };

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
      antialias: false, // 后期处理开启时关闭抗锯齿性能更好
      powerPreference: "high-performance",
      preserveDrawingBuffer: false // 除非录像否则关闭以提升性能
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // 限制像素比例在 1.5 以内防止 4K 屏过慢
    containerRef.current.appendChild(renderer.domElement);
    console.log('Canvas 已添加到 DOM');
    console.log('Canvas 尺寸:', renderer.domElement.width, 'x', renderer.domElement.height);
    console.log('Canvas style:', renderer.domElement.style.cssText);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    // 降低 Bloom 画布分辨率及强度以提升低端设备性能
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 1.0, 0.4, 0.3);
    composer.addPass(bloomPass);

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
            if (dt < 1.0) {
              m.uniforms.uFormation.value = 0.0;
            } else if (dt < 5.0) {
              const progress = (dt - 1.0) / 4.0;
              m.uniforms.uFormation.value = progress;
            } else {
              m.uniforms.uFormation.value = 1.0;
            }
          }
        }

        // --- 歌词系统已由 UI 方案取代 ---

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

  const handleStart = async () => {
    setIsProcessing(true);
    try {
      // 核心改为：从后端接口获取当前文件夹内的所有图片
      // 使用重试机制等待后端启动 (最多等待 10秒)
      const listRes = await fetchWithRetry(MUSIC_API + '/local/images', {}, 5, 2000);
      let listData;
      try {
        listData = await listRes.json();
      } catch (jsonErr) {
        throw new Error("后端返回了非 JSON 数据，可能是路径错误或后端异常。" + jsonErr.message);
      }

      let imageUrls = [];
      if (listData.code === 200 && listData.images) {
        // 构建完整的本地图片对象
        imageUrls = listData.images.map(img => {
          // 核心：使用后端托管的静态资源地址 (需要补全 baseURL)
          // 虽然 img 只是文件名，但为了后续 fetch 能够复用逻辑，我们这里组装完整 URL
          return `${MUSIC_API}/image/${img}`;
        });
        console.log(`[资源加载] 发现 ${imageUrls.length} 张本地图片`);
      } else {
        // 后退方案：如果接口失败或没图，保留最基础的核心素材
        imageUrls = [`${MUSIC_API}/image/b150350bc9b7290c8fe9351c8f787a1a.png`];
        // 如果是 500 错误，也抛出异常以便弹窗
        if (listData.code === 500) throw new Error(listData.error);
      }

      const loadedImages = await Promise.all(imageUrls.map(async (src) => {
        const response = await fetch(src);
        const blob = await response.blob();
        const file = new File([blob], src.substring(src.lastIndexOf('/') + 1), { type: blob.type });
        return processImage(file, 1, true);
      }));

      if (loadedImages.length > 0) {
        const first = loadedImages[0];
        setNebulaInfo({ name: first.name, lore: "创世基底已确立。", mainColor: first.mainColor });
        initConstellation(first);

        setGallery(loadedImages);
        galleryRef.current = loadedImages;
        setCurrentIdx(0);
        currentIdxRef.current = 0;
        setIsAutoCycle(true); // 默认开启自动流转
        setTimeLeft(6); // 初始等待 6 秒

        // 启动时显示闲置星团
      }
      setIsStarted(true);
    } catch (err) {
      console.error("动态加载本地图片失败:", err);
      const msg = err.message || "Unknown Error";
      alert("加载失败: " + msg + "\n请勿关闭后端黑窗口。如果提示 Failed to fetch，说明是 CORS 协议或网络连接被拦截。");
    } finally {
      setIsProcessing(false);
    }

    // 如果想要默认播放音乐，可以在这里处理 (目前全靠网易云)
    if (!audioRef.current) {
      // Example: Load a default background music if needed
      // const audio = new Audio('/audio/default_bg_music.mp3');
      // audio.loop = true;
      // audio.crossOrigin = "anonymous";
      // audio.play();
      // audioRef.current = { audio, context: null, analyser: null, dataArray: null };
      // setIsPlaying(true);
      // setAudioData({ name: 'Default Background Music' });
    }
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

          // 动态采样目标：确保总像素点在 42000 左右，完美契合 45000 的主体上限
          // 让 w * (w/aspect) = 42000 => w = sqrt(42000 * aspect)
          const targetTotalPixels = 42000;
          const sampleWidth = Math.sqrt(targetTotalPixels * aspect);
          const sampleHeight = sampleWidth / aspect;

          canvas.width = Math.floor(sampleWidth);
          canvas.height = Math.floor(sampleHeight);

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
            const src = Math.floor(Math.random() * activeSubCount) * 3;
            const angle = Math.random() * Math.PI * 2;
            const radius = spreadX * (0.6 + Math.random() * 0.9);
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
              const spiralAngle = angleOffset + t * Math.PI * 3.0;
              const r = ringRadiusBase * (0.1 + t * 0.9);
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
          const mainColor = `#${avgR.toString(16).padStart(2, '0')}${avgG.toString(16).padStart(2, '0')}${avgB.toString(16).padStart(2, '0')} `;

          const thumbCanvas = document.createElement('canvas');
          thumbCanvas.width = 64; thumbCanvas.height = 64;
          const tCtx = thumbCanvas.getContext('2d');
          tCtx.drawImage(img, 0, 0, 64, 64);
          const thumb = thumbCanvas.toDataURL('image/jpeg', 0.8);

          resolve({ pos, col, mainColor, name: file.name, thumb });
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
        // 先上传到服务器
        const formData = new FormData();
        formData.append('image', file);
        const uploadRes = await fetch(`${MUSIC_API}/local/image/upload`, {
          method: 'POST',
          body: formData
        });
        const uploadData = await uploadRes.json();

        if (uploadData.code === 200) {
          const data = await processImage(file, 1, true);
          results.push(data);
        } else {
          console.error("上传失败:", file.name, uploadData.msg);
        }
      } catch (err) { console.error("处理失败:", file.name, err); }
    }

    if (!isGalleryOnly && results.length > 0) {
      // 核心修复：如果是“启动创世”，必须清空旧图库，确保索引 0 指向正确的新图
      const first = results[0];
      setNebulaInfo({ name: first.name, lore: "创世基底已确立。", mainColor: first.mainColor });
      initConstellation(first);

      setGallery(results);
      galleryRef.current = results;
      setCurrentIdx(0);
      currentIdxRef.current = 0;
      setIsStarted(true); // Mark as started when images are uploaded
    } else if (results.length > 0) {
      const newItems = [...gallery, ...results];
      setGallery(newItems);
      galleryRef.current = newItems;
    }

    setIsProcessing(false);
    if (results.length > 1) {
      // 核心改进：初始给予 6 秒等待，确保 Formation (5s) 完成后再启动 3s 的流转节奏
      // 这样第一张图有足够时间展现完整形态
      setTimeLeft(6);
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
    const items = galleryRef.current;
    if (items.length <= 1 || isMorphing) return;

    // 使用函数式更新确保获取最新的索引
    setCurrentIdx(prevIdx => {
      let targetIdx;
      if (targetItem) {
        targetIdx = items.findIndex(item => item === targetItem || item.name === targetItem.name);
      } else {
        // 核心修复：这里不再依赖外部作用域的 currentIdx，而是严格依赖 prevIdx
        targetIdx = (prevIdx + 1) % items.length;
      }

      if (targetIdx === -1 || targetIdx === prevIdx) return prevIdx;

      const nextItem = items[targetIdx];
      console.log(`[形态流转] 下标路径确认: ${prevIdx} -> ${targetIdx} / 总数: ${items.length}`);

      // 将物理形态切换剥离出状态更新钩子，保证在下一帧物理生效
      setTimeout(() => {
        executeMorphSequence(nextItem);
      }, 0);

      return targetIdx;
    });
  };

  const executeMorphSequence = (nextItem) => {
    if (!nextItem || !sceneRef.current || !sceneRef.current.constellation) return;

    // 1. 物理层对接
    promoteTargetToSource();

    // 2. 注入新目标坐标与颜色
    const geo = sceneRef.current.constellation.geometry;
    geo.attributes.position2.array.set(nextItem.pos);
    geo.attributes.position2.needsUpdate = true;
    geo.attributes.customColor2.array.set(nextItem.col);
    geo.attributes.customColor2.needsUpdate = true;

    // 3. UI 状态同步
    setNebulaInfo2({ name: nextItem.name, lore: "形态跃进中，粒子正在重组...", mainColor: nextItem.mainColor });
    setNebulaInfo({ name: nextItem.name, lore: "能量相位同步，开启新一轮演化。", mainColor: nextItem.mainColor });

    // 4. 重置倒计时并启动动画
    setTimeLeft(stayDuration);
    setMorph(0);
    startMorphEvolution();
  };

  const handleDeleteImage = async (e, item, idx) => {
    e.stopPropagation(); // 防止触发切换
    if (!confirm(`确定要彻底删除星辰“${item.name}”吗？\n此操作将同时从磁盘删除文件。`)) return;

    try {
      const filename = item.name;
      const res = await fetch(`${MUSIC_API}/local/image/${filename}`, {
        method: 'DELETE'
      });
      const data = await res.json();

      if (data.code === 200) {
        const newGallery = gallery.filter((_, i) => i !== idx);
        setGallery(newGallery);
        galleryRef.current = newGallery;

        // 如果删除的是当前选中的图，自动切换
        if (currentIdx === idx) {
          if (newGallery.length > 0) {
            const nextIdx = idx % newGallery.length;
            setCurrentIdx(nextIdx);
            currentIdxRef.current = nextIdx;
            executeMorphSequence(newGallery[nextIdx]);
          } else {
            // 没有图了，重置状态
            setNebulaInfo(null);
            setIsStarted(false);
          }
        } else if (currentIdx > idx) {
          // 如果删除的是当前索引之前的图，索引需要减 1 以保持对齐
          const nextIdx = currentIdx - 1;
          setCurrentIdx(nextIdx);
          currentIdxRef.current = nextIdx;
        }
      } else {
        alert("删除失败: " + data.msg);
      }
    } catch (err) {
      console.error("删除请求失败:", err);
      alert("网络错误，删除失败。");
    }
  };

  const processTextToPoints = (text, density = 2) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 2048; // 增加画布宽度
    canvas.height = 256;

    // 核心优化：使用用户提供的像素字体 'UranusPixel'
    // 像素字体不需要太大的字重，我们设定一个适中的字号
    let fontSize = 80;
    ctx.font = `400 ${fontSize}px "UranusPixel", sans-serif`;

    // 自动缩放字体以适应宽度
    let textWidth = ctx.measureText(text).width;
    if (textWidth > canvas.width * 0.9) {
      fontSize = Math.floor(fontSize * (canvas.width * 0.9 / textWidth));
      ctx.font = `400 ${fontSize}px "UranusPixel", sans-serif`;
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'white';

    // 核心修复：如果 text 为空或字符串 "null"，直接返回空点集
    if (!text || text === 'null') return [];

    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const allOpaqueIndices = [];
    for (let i = 0; i < imageData.length; i += 4) {
      if (imageData[i] > 128) allOpaqueIndices.push(i / 4);
    }

    const MAX_PARTICLES = 60000; // 再次提升上限到 6万，确保长句也密集
    let finalIndices = allOpaqueIndices;

    // 核心修复：如果像数点过多，使用“随机抽样”而非“固定步长抽样”
    // 这能彻底消除由于固定步长导致的水平扫描线感 ( aliasing )
    if (allOpaqueIndices.length > MAX_PARTICLES) {
      finalIndices = [];
      const len = allOpaqueIndices.length;
      for (let i = 0; i < MAX_PARTICLES; i++) {
        // 随机抽取 6万个不重复的点（近似快速实现）
        const randIdx = Math.floor(Math.random() * len);
        finalIndices.push(allOpaqueIndices[randIdx]);
      }
    }

    const points = [];
    for (let i = 0; i < finalIndices.length; i++) {
      const pixelIdx = finalIndices[i];
      const x = pixelIdx % canvas.width;
      const y = Math.floor(pixelIdx / canvas.width);

      // 坐标映射：稍微缩小横向比例，防止文字拉伸，并微调缩放
      const px = (x - canvas.width / 2) * 0.08;
      const py = (canvas.height / 2 - y) * 0.08;
      const pz = 0;
      points.push([px, py, pz]);
    }
    return points;
  };

  const startMorphEvolution = () => {
    setIsMorphing(true);
    let startTimestamp = null;
    const duration = morphDuration * 1000;

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

  // 优化的自动流转逻辑：独立计时，严格触发
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

  // 独立监听：当计时到零时，执行且仅执行一次跃迁触发
  useEffect(() => {
    if (isAutoCycle && !isMorphing && timeLeft === 0 && gallery.length > 1) {
      console.log("[流转中心] 倒计时结束，触发下一形态...");
      triggerNextMorph();
    }
  }, [timeLeft, isAutoCycle, isMorphing, gallery.length]);

  // 歌词定时同步
  useEffect(() => {
    if (!audioRef.current || lyrics.length === 0) return;
    const audio = audioRef.current.audio;
    const handleTimeUpdate = () => {
      const time = audio.currentTime;
      let targetLyric = "";
      for (let i = lyrics.length - 1; i >= 0; i--) {
        if (time >= lyrics[i].time) {
          targetLyric = lyrics[i].text;
          break;
        }
      }
      if (targetLyric !== currentLyric) {
        setCurrentLyric(targetLyric);
      }
    };
    audio.addEventListener('timeupdate', handleTimeUpdate);
    return () => audio.removeEventListener('timeupdate', handleTimeUpdate);
  }, [lyrics, currentLyric]);

  // 歌词定时同步（由 currentLyric 状态驱动 UI）
  useEffect(() => {
    if (isStarted) {
      // 这里可以做一些 UI 触发逻辑
    }
  }, [currentLyric, isStarted]);


  // 监听歌曲结束，如果是 FM 模式自动下一首
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audio.audio) return; // Ensure audio.audio exists

    const handleEnded = () => {
      if (musicMode === 'fm') {
        playNextFM();
      }
    };

    audio.audio.addEventListener('ended', handleEnded);
    return () => audio.audio.removeEventListener('ended', handleEnded);
  }, [musicMode, fmQueue, audioRef.current]); // Add audioRef.current to dependencies

  // --- 网易云音乐逻辑实现 ---

  // 1. 获取登录二维码 key 并生成二维码
  const getLoginQR = async () => {
    try {
      setIsMusicLoading(true);
      // 1. 获取 key
      const keyRes = await fetch(`${MUSIC_API}/login/qr/key?timestamp=${Date.now()}`);
      const keyData = await keyRes.json();
      const key = keyData.data.unikey;

      // 2. 生成二维码
      const qrRes = await fetch(`${MUSIC_API}/login/qr/create?key=${key}&qrimg=true&timestamp=${Date.now()}`);
      const qrData = await qrRes.json();

      setLoginQR(qrData.data.qrimg);

      // 3. 开始轮询
      checkLoginStatus(key);

    } catch (err) {
      console.error("获取二维码失败:", err);
      // 精确显示报错详情，诊断 CORS 或网络问题
      const detail = err.message || "Unknown Error";
      alert('登录连接失败: ' + detail + '\n(请确保后端 4000 端口已开启且未被防火墙拦截)');
    } finally {
      setIsMusicLoading(false);
    }
  };

  // 2. 轮询登录状态
  const checkLoginStatus = (key) => {
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`${MUSIC_API}/login/qr/check?key=${key}&timestamp=${Date.now()}`);
        const data = await res.json();

        // 800 为二维码过期, 801 为等待扫码, 802 为待确认, 803 为授权登录成功
        if (data.code === 800) {
          alert('二维码已过期，请刷新');
          clearInterval(timer);
        } else if (data.code === 803) {
          clearInterval(timer);
          const newCookie = data.cookie;
          setCookie(newCookie);
          localStorage.setItem('netease_cookie', newCookie); // 持久化存储
          setLoginQR(null);
          // 获取用户信息
          fetchMusicUserInfo(newCookie);
        }
      } catch (err) {
        console.error("轮询失败:", err);
        clearInterval(timer);
      }
    }, 2000);
  };

  // 3. 获取用户信息及歌单
  const fetchMusicUserInfo = async (userCookie) => {
    try {
      setIsMusicLoading(true);
      const cookieStr = encodeURIComponent(userCookie || cookie);

      // 获取账号信息
      const userRes = await fetch(`${MUSIC_API}/user/account?cookie=${cookieStr}`);
      const userData = await userRes.json();

      if (userData.code === 200 && userData.profile) {
        setMusicUser({
          nickname: userData.profile.nickname,
          avatar: userData.profile.avatarUrl,
          uid: userData.profile.userId
        });

        // 获取歌单
        const plRes = await fetch(`${MUSIC_API}/user/playlist?uid=${userData.profile.userId}&cookie=${cookieStr}`);
        const plData = await plRes.json();

        if (plData.code === 200) {
          setPlaylists(plData.playlist.map(item => ({
            name: item.name,
            img: item.coverImgUrl,
            id: item.id,
            count: item.trackCount
          })));
        }
      }
    } catch (err) {
      console.error("获取网易云数据失败:", err);
    } finally {
      setIsMusicLoading(false);
    }
  };

  // 4. 获取歌单歌曲列表
  const fetchPlaylistSongs = async (pid) => {
    try {
      setIsMusicLoading(true);
      const cookieStr = encodeURIComponent(cookie);
      // 获取歌单所有歌曲
      const res = await fetch(`${MUSIC_API}/playlist/track/all?id=${pid}&limit=30&offset=0&cookie=${cookieStr}`);
      const data = await res.json();

      if (data.code === 200) {
        setSongList(data.songs.map(s => ({
          name: s.name,
          artist: s.ar[0].name,
          album: s.al.name,
          id: s.id,
          albumArt: s.al.picUrl
        })));
        setShowSongList(true);
      }
    } catch (err) {
      console.error("获取歌单歌曲失败:", err);
    } finally {
      setIsMusicLoading(false);
    }
  };

  // --- 新增功能实现 ---

  // 4.1 获取每日推荐
  const fetchDailyRecommend = async () => {
    try {
      setIsMusicLoading(true);
      const cookieStr = encodeURIComponent(cookie);
      const res = await fetch(`${MUSIC_API}/recommend/songs?cookie=${cookieStr}`);
      const data = await res.json();

      if (data.code === 200) {
        setRecommendSongs(data.data.dailySongs.map(s => ({
          name: s.name,
          artist: s.ar[0].name,
          album: s.al.name,
          id: s.id,
          albumArt: s.al.picUrl
        })));
        setMusicMode('recommend');
      } else {
        alert('获取推荐失败，请确保已登录');
      }
    } catch (err) {
      console.error("获取日推失败:", err);
    } finally {
      setIsMusicLoading(false);
    }
  };

  // 4.2 获取私人 FM (需要特殊处理队列)
  const fetchPersonalFM = async (isInit = false) => {
    try {
      if (!isInit) setIsMusicLoading(true);
      const cookieStr = encodeURIComponent(cookie);
      const res = await fetch(`${MUSIC_API}/personal_fm?timestamp=${Date.now()}&cookie=${cookieStr}`);
      const data = await res.json();

      if (data.code === 200) {
        const newTracks = data.data.map(s => ({
          name: s.name,
          artist: s.artists[0].name,
          album: s.album.name,
          id: s.id,
          albumArt: s.album.picUrl
        }));

        if (isInit) {
          setFmQueue(newTracks);
          // 立即播放第一首
          if (newTracks.length > 0) playOnlineSong(newTracks[0]);
          setMusicMode('fm');
        } else {
          // 追加到队列
          setFmQueue(prev => [...prev, ...newTracks]);
        }
      }
    } catch (err) {
      console.error("获取FM失败:", err);
    } finally {
      if (!isInit) setIsMusicLoading(false);
    }
  };

  const playNextFM = () => {
    // FM 逻辑：移除当前首，播放下一首。如果队列快空了，预加载。
    const nextQueue = [...fmQueue];
    nextQueue.shift(); // 移除刚刚播放的
    setFmQueue(nextQueue);

    if (nextQueue.length === 0) {
      fetchPersonalFM(true);
    } else {
      if (nextQueue.length < 3) fetchPersonalFM(false); // 预加载
      playOnlineSong(nextQueue[0]);
    }
  };

  const startFM = () => {
    setMusicMode('fm');
    fetchPersonalFM(true);
  }

  // 4.3 获取听歌排行 (周榜 type=1)
  const fetchListeningHistory = async () => {
    try {
      setIsMusicLoading(true);
      const cookieStr = encodeURIComponent(cookie);
      const res = await fetch(`${MUSIC_API}/user/record?uid=${musicUser.uid}&type=1&cookie=${cookieStr}`);
      const data = await res.json();

      if (data.code === 200) {
        setHistorySongs(data.weekData.map(item => ({
          name: item.song.name,
          artist: item.song.ar[0].name,
          album: item.song.al.name,
          id: item.song.id,
          albumArt: item.song.al.picUrl,
          score: item.score // 热度分数
        })));
        setMusicMode('history');
      }
    } catch (err) {
      console.error("获取听歌排行失败:", err);
    } finally {
      setIsMusicLoading(false);
    }
  };

  // 5. 播放歌曲 (获取播放链接)
  const playOnlineSong = async (song) => {
    try {
      setIsMusicLoading(true);
      const cookieStr = encodeURIComponent(cookie);
      // 获取标准音质
      const res = await fetch(`${MUSIC_API}/song/url?id=${song.id}&cookie=${cookieStr}`);
      const data = await res.json();

      if (data.code === 200 && data.data && data.data[0]) {
        const musicUrl = data.data[0].url;
        if (!musicUrl) {
          alert('无法获取该歌曲链接（可能是VIP专享或无版权）');
          return;
        }

        // Initialize AudioContext and Analyser if not already done
        if (!audioRef.current || !audioRef.current.audio) {
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          const ctx = new AudioContext();
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          const dataArray = new Uint8Array(analyser.frequencyBinCount);

          const audio = new Audio();
          audio.loop = false; // FM mode handles looping/next song
          audio.crossOrigin = "anonymous";

          const source = ctx.createMediaElementSource(audio);
          source.connect(analyser);
          analyser.connect(ctx.destination);

          audioRef.current = {
            audio,
            context: ctx,
            analyser,
            dataArray
          };
        }

        audioRef.current.audio.src = musicUrl;
        audioRef.current.audio.play();
        setIsPlaying(true);
        setAudioData({ name: song.name, url: musicUrl });
        setCurrentTrack(song);
        fetchLyrics(song.id); // 获取歌词
      }
    } catch (err) {
      console.error("启动在线播放失败:", err);
    } finally {
      setIsMusicLoading(false);
    }
  };

  // --- 歌词处理逻辑 ---
  const parseLRC = (lrcString) => {
    if (!lrcString) return [];
    const lines = lrcString.split('\n');
    const result = [];
    // 兼容 [00:00.00], [00:00.000], [00:00] 等格式
    const timeReg = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/;

    for (const line of lines) {
      const match = timeReg.exec(line);
      if (match) {
        const min = parseInt(match[1]);
        const sec = parseInt(match[2]);
        const msStr = match[3] || '000';
        const ms = parseInt(msStr.length === 3 ? msStr : msStr * 10);
        const time = min * 60 + sec + ms / 1000;
        const text = line.replace(/\[.*?\]/g, '').trim(); // 移除所有中括号标签
        if (text) result.push({ time, text });
      }
    }
    // 按时间排序，防止某些 LRC 乱序
    return result.sort((a, b) => a.time - b.time);
  };

  const fetchLyrics = async (id) => {
    try {
      const cookieStr = encodeURIComponent(cookie);
      // 增加 cookie 传递，某些加密歌词需要登录态
      const res = await fetch(`${MUSIC_API}/lyric?id=${id}&cookie=${cookieStr}`);
      const data = await res.json();

      console.log("[歌词中心] 原始数据:", data);

      if (data.lrc && data.lrc.lyric) {
        const parsed = parseLRC(data.lrc.lyric);
        if (parsed.length > 0) {
          setLyrics(parsed);
          setCurrentLyric("");
          console.log(`[歌词中心] 解析成功: ${parsed.length} 行`);
        } else {
          setLyrics([]);
          setCurrentLyric("歌词格式无法解析");
        }
      } else {
        setLyrics([]);
        setCurrentLyric("纯音乐 / 暂无存库歌词");
      }
    } catch (err) {
      console.error("[歌词中心] 获取失败:", err);
      setLyrics([]);
      setCurrentLyric("歌词获取失败 (连接超时)");
    }
  };

  const [songList, setSongList] = useState([]);      // 当前查看到的歌曲列表
  const [showSongList, setShowSongList] = useState(false); // 是否显示歌单详情

  return (
    <div className="relative w-full h-screen bg-[#000001] overflow-hidden text-white font-sans">
      <div ref={containerRef} className="absolute inset-0 z-0" />
      <div className="absolute inset-0 pointer-events-none z-10 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(0,0,0,0.6)_100%)]" />

      {/* 沉浸式侧边菜单：左侧控制 */}
      {isStarted && nebulaInfo && (
        <>
          <div className="side-trigger-marker left-trigger">
            <span className="trigger-icon text-2xl">⚙️</span>
          </div>
          <div className="side-menu-wrapper left-menu-wrapper">
            <div className="w-80 p-6 bg-black/70 backdrop-blur-2xl border border-white/10 rounded-3xl pointer-events-auto h-full overflow-y-auto no-scrollbar">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-light tracking-widest uppercase text-blue-200">可视化控制</h3>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center py-2 px-4 bg-blue-500/10 rounded-xl border border-blue-500/20">
                  <span className="text-[10px] text-blue-300 uppercase tracking-widest font-medium">下一次跃迁</span>
                  <span className="text-xs text-blue-400 font-mono font-bold animate-pulse">{timeLeft}s</span>
                </div>

                <div className="h-[1px] w-full bg-white/5 my-2" />

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

                <div className="pt-2 border-t border-white/5">
                  <label className="text-[10px] text-blue-300/80 tracking-wider uppercase block mb-2">停留时长: {stayDuration}s</label>
                  <input type="range" min="1" max="10" step="1" value={stayDuration} onChange={(e) => setStayDuration(parseInt(e.target.value))} className="w-full h-1 bg-blue-500/20 rounded-lg appearance-none cursor-pointer" />
                </div>

                <div>
                  <label className="text-[10px] text-blue-300/80 tracking-wider uppercase block mb-2">变换速度: {morphDuration}s</label>
                  <input type="range" min="1" max="15" step="0.5" value={morphDuration} onChange={(e) => setMorphDuration(parseFloat(e.target.value))} className="w-full h-1 bg-blue-500/20 rounded-lg appearance-none cursor-pointer" />
                </div>

                <div className="h-[1px] w-full bg-white/5 my-2" />

                {/* 歌词设置 (折叠面板) */}
                <details className="mt-4 group open:bg-white/5 rounded-xl transition-all border border-transparent open:border-white/10 overflow-hidden">
                  <summary className="flex items-center justify-between p-3 cursor-pointer hover:bg-white/5 transition-all">
                    <span className="text-[10px] text-white/40 uppercase tracking-widest font-bold group-open:text-blue-400">歌词设置 Lyric Display</span>
                    <span className="text-white/20 text-[8px] transform group-open:rotate-180 transition-transform">▼</span>
                  </summary>
                  <div className="p-3 pt-0 space-y-4">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center px-1">
                        <label className="text-[9px] text-white/30 uppercase tracking-[0.2em]">字体缩放 Scale</label>
                        <span className="text-[9px] font-mono text-blue-400/80">{lyricScale.toFixed(2)}x</span>
                      </div>
                      <input
                        type="range" min="0.5" max="2.5" step="0.05"
                        value={lyricScale}
                        onChange={(e) => setLyricScale(parseFloat(e.target.value))}
                        className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-500"
                      />
                    </div>
                  </div>
                </details>

                <div className="h-[1px] w-full bg-white/5 my-2" />

                <div className="h-[1px] w-full bg-white/5 my-2" />

                <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/10 mt-2">
                  <span className="text-[10px] text-white/40 uppercase tracking-widest font-bold">显示歌词 Display Lyrics</span>
                  <button
                    onClick={() => setShowLyrics(!showLyrics)}
                    className={`w-10 h-5 rounded-full transition-all relative ${showLyrics ? 'bg-blue-600' : 'bg-white/10'}`}
                  >
                    <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${showLyrics ? 'left-6' : 'left-1'}`} />
                  </button>
                </div>

                <button
                  onClick={() => {
                    setSaturation(0.5); setBrightness(1.1); setContrast(1.2); setTwinkleStrength(0.3);
                    setStayDuration(3); setMorphDuration(6);
                    setMorph(0); setIsAutoCycle(false);
                    setShowLyrics(true);
                  }}
                  className="w-full py-2 text-[9px] tracking-wider uppercase bg-white/5 hover:bg-white/10 border border-white/10 rounded-full transition-all"
                >
                  重置色彩与节奏
                </button>

                {/* 集成式堆叠图库 */}
                {gallery.length > 0 && (
                  <div className="pt-4 border-t border-white/5 mt-2">
                    <div className="flex justify-between items-center mb-2 px-1">
                      <span className="text-[9px] text-white/30 uppercase tracking-[0.2em]">星辰预览 ({gallery.length})</span>
                    </div>
                    <div
                      ref={scrollContainerRef}
                      className="menu-gallery-stack no-scrollbar"
                      onMouseMove={(e) => {
                        if (!scrollContainerRef.current) return;
                        const rect = scrollContainerRef.current.getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        const width = rect.width;
                        const edgeSize = width * 0.2;
                        if (x < edgeSize) {
                          if (!scrollScrollInterval.current) {
                            scrollScrollInterval.current = setInterval(() => {
                              if (scrollContainerRef.current) scrollContainerRef.current.scrollLeft -= 5;
                            }, 16);
                          }
                        } else if (x > width - edgeSize) {
                          if (!scrollScrollInterval.current) {
                            scrollScrollInterval.current = setInterval(() => {
                              if (scrollContainerRef.current) scrollContainerRef.current.scrollLeft += 5;
                            }, 16);
                          }
                        } else {
                          if (scrollScrollInterval.current) {
                            clearInterval(scrollScrollInterval.current);
                            scrollScrollInterval.current = null;
                          }
                        }
                      }}
                      onMouseLeave={() => {
                        if (scrollScrollInterval.current) {
                          clearInterval(scrollScrollInterval.current);
                          scrollScrollInterval.current = null;
                        }
                      }}
                    >
                      {gallery.map((item, idx) => (
                        <div
                          key={idx}
                          onClick={() => triggerNextMorph(item)}
                          className={`menu-gallery-item ${currentIdx === idx ? 'active' : ''}`}
                          title={item.name}
                        >
                          <img src={item.thumb} alt={item.name} />
                          <div className="mini-dot" />
                          <div className="delete-btn" onClick={(e) => handleDeleteImage(e, item, idx)}>×</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-2 border-t border-white/5 space-y-2">
                  <div className="flex gap-2">
                    <button className="flex-1 py-2 text-[9px] tracking-wider uppercase bg-white/5 hover:bg-white/10 border border-white/10 rounded-full transition-all" onClick={() => { setNebulaInfo(null); setGallery([]); setIsAutoCycle(true); setMorph(0); setTimeLeft(0); setCurrentIdx(0); setIsStarted(false); }}>退出创世</button>
                    <label className="flex-1 py-2 text-[9px] tracking-wider uppercase bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-300 rounded-full cursor-pointer text-center flex items-center justify-center">
                      <input type="file" accept="image/*" multiple onChange={(e) => handleMultiUpload(e, true)} className="hidden" />
                      + 扩充
                    </label>
                  </div>
                  {/* Removed music upload button */}
                  {audioData && (
                    <button className={isPlaying ? 'w-full py-2 text-[9px] tracking-wider uppercase bg-blue-500/20 text-blue-200 border border-blue-500/20 rounded-full' : 'w-full py-2 text-[9px] tracking-wider uppercase bg-white/5 hover:bg-white/10 border border-white/10 rounded-full'} onClick={togglePlay}>{isPlaying ? "⏸ 暂停" : "▶ 播放"}</button>
                  )}
                  <button className={isRecording ? 'w-full py-2 text-[9px] tracking-wider uppercase bg-red-500/20 text-red-200 border border-red-500/20 rounded-full animate-pulse' : 'w-full py-2 text-[9px] tracking-wider uppercase bg-white/5 hover:bg-white/10 border border-white/10 rounded-full'} onClick={toggleRecording}>{isRecording ? "🔴 停止录制" : "⭕ 开启录制"}</button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* 移除旧的浮动齿轮/音符按钮，已由侧边感应取代 */}

      <div className="absolute inset-0 z-20 pointer-events-none flex flex-col items-center justify-between p-6">
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          {!isStarted && !isProcessing && (
            <div className="max-w-xl pointer-events-auto animate-in fade-in zoom-in duration-1000 flex flex-col items-center">
              <h1 className="text-6xl font-thin tracking-[1.2em] mb-8 uppercase text-transparent bg-clip-text bg-gradient-to-r from-blue-100 via-white to-blue-400 text-center select-none mr-[-1.2em]">STELLAR GALAXY</h1>
              <p className="text-sm font-light tracking-[0.6em] opacity-40 mb-24 uppercase italic text-center select-none mr-[-0.6em]">多维流转 · 奇点喷发 · 粒子守恒</p>

              <button
                onClick={handleStart}
                className="group relative w-64 h-16 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full backdrop-blur-md transition-all duration-500 overflow-hidden flex items-center justify-center"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-blue-500/0 via-blue-500/10 to-blue-500/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />

                {/* 装饰星号：绝对定位保持平衡 */}
                <span className="absolute left-6 text-blue-400 animate-pulse text-xl">✦</span>

                {/* 文字：绝对居中 */}
                <span className="text-lg font-light tracking-[0.5em] text-white group-hover:text-blue-200 transition-colors mr-[-0.5em]">
                  启动 创世
                </span>
              </button>
            </div>
          )}

          {isProcessing && (
            <div className="flex flex-col items-center">
              <div className="w-10 h-10 border-2 border-white/10 border-t-blue-500 rounded-full animate-spin mb-6" />
              <p className="text-[10px] tracking-[0.6em] font-light uppercase opacity-40">初始化奇点漩涡...</p>
            </div>
          )}
        </div>
      </div>
      {/* 沉浸式侧边菜单：右侧音乐 */}
      {nebulaInfo && (
        <>
          <div className="side-trigger-marker right-trigger">
            <span className="trigger-icon text-2xl">🎵</span>
          </div>
          <div className="side-menu-wrapper right-menu-wrapper">
            <div className="w-80 h-full p-6 bg-black/70 backdrop-blur-2xl border border-white/10 rounded-3xl pointer-events-auto flex flex-col overflow-hidden">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-sm font-light tracking-widest uppercase text-blue-200">音乐指令中心</h3>
                <div className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${musicUser ? 'bg-green-500' : 'bg-red-500'} animate-pulse`} />
                  <span className="text-[10px] text-white/30 tracking-tight">{musicUser ? '已连接' : '未登录'}</span>
                </div>
              </div>

              {!musicUser ? (
                <div className="flex-1 flex flex-col items-center justify-center space-y-6">
                  {!loginQR ? (
                    <button
                      onClick={getLoginQR}
                      disabled={isMusicLoading}
                      className="px-8 py-3 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-400 rounded-full text-[10px] tracking-[0.2em] uppercase transition-all disabled:opacity-50"
                    >
                      {isMusicLoading ? '获取中...' : '扫码登录网易云'}
                    </button>
                  ) : (
                    <div className="flex flex-col items-center space-y-4">
                      <div className="p-3 bg-white rounded-2xl overflow-hidden w-40 h-40">
                        <img src={loginQR} alt="QR Code" className="w-full h-full object-contain" />
                      </div>
                      <p className="text-[10px] text-white/40 tracking-wider">请使用网易云音乐 APP 扫码</p>
                    </div>
                  )}
                  <p className="text-[9px] text-white/20 text-center leading-relaxed">
                    不再需要抓取 Cookie<br />
                    扫码即可同步您的歌单
                  </p>
                </div>
              ) : (
                <div className="flex-1 flex flex-col min-h-0">
                  {/* 用户信息 */}
                  <div className="flex items-center gap-3 mb-6 p-3 bg-white/5 rounded-2xl border border-white/5 group relative">
                    <img src={musicUser.avatar} className="w-10 h-10 rounded-full border border-blue-500/30" alt="avatar" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-blue-100 truncate">{musicUser.nickname}</p>
                      <p className="text-[9px] text-white/30 uppercase tracking-tighter">探索者</p>
                    </div>
                    <button
                      onClick={handleLogout}
                      title="退出登录"
                      className="opacity-0 group-hover:opacity-100 p-2 text-white/40 hover:text-red-400 transition-all text-xs"
                    >
                      Logout
                    </button>
                  </div>

                  {/* 功能导航 tabs */}
                  <div className="flex bg-white/5 rounded-xl p-1 mb-4">
                    {[
                      { id: 'playlist', icon: '📂', label: '歌单' },
                      { id: 'recommend', icon: '📅', label: '日推' },
                      { id: 'fm', icon: '📻', label: 'FM' },
                      { id: 'history', icon: '🕒', label: '排行' },
                    ].map(tab => (
                      <button
                        key={tab.id}
                        onClick={() => {
                          setMusicMode(tab.id);
                          setShowSongList(false);
                          if (tab.id === 'recommend') fetchDailyRecommend();
                          if (tab.id === 'fm') startFM();
                          if (tab.id === 'history') fetchListeningHistory();
                          if (tab.id === 'playlist') { /* 已经加载过了 */ }
                        }}
                        className={`flex-1 py-1.5 rounded-lg text-[10px] transition-all flex items-center justify-center gap-1 ${musicMode === tab.id ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20' : 'text-white/40 hover:text-white/80 hover:bg-white/5'}`}
                      >
                        <span>{tab.icon}</span>
                        <span>{tab.label}</span>
                      </button>
                    ))}
                  </div>

                  {/* 歌单/歌曲/功能 切换容器 */}
                  <div className="flex-1 overflow-y-auto no-scrollbar space-y-2 mb-4">
                    {/* --- 模式：歌单 --- */}
                    {musicMode === 'playlist' && (
                      !showSongList ? (
                        <>
                          <p className="text-[9px] text-white/20 uppercase tracking-[0.2em] mb-2 px-1">我的网易云歌单</p>
                          {playlists.length === 0 ? (
                            <div className="h-32 flex items-center justify-center border border-white/5 border-dashed rounded-2xl">
                              <span className="text-[10px] text-white/10 italic">暂无同步数据</span>
                            </div>
                          ) : (
                            playlists.map((pl, idx) => (
                              <button
                                key={idx}
                                onClick={() => fetchPlaylistSongs(pl.id)}
                                className="w-full p-3 flex items-center gap-3 bg-white/5 hover:bg-white/10 rounded-xl transition-all text-left group"
                              >
                                <div className="w-8 h-8 bg-blue-500/20 rounded-lg flex items-center justify-center overflow-hidden">
                                  {pl.img ? <img src={pl.img} className="w-full h-full object-cover" /> : <span className="text-xs text-blue-400">♫</span>}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-[11px] text-white/60 group-hover:text-blue-200 truncate">{pl.name}</p>
                                  <p className="text-[9px] text-white/20">{pl.count} 首歌曲</p>
                                </div>
                              </button>
                            ))
                          )}
                        </>
                      ) : (
                        <>
                          <div className="flex items-center justify-between mb-2 px-1">
                            <p className="text-[9px] text-white/20 uppercase tracking-[0.2em]">歌曲列表 ({songList.length})</p>
                            <button onClick={() => setShowSongList(false)} className="text-[9px] text-blue-400/60 hover:text-blue-400 tracking-wider">返回歌单</button>
                          </div>
                          {songList.map((song, idx) => (
                            <button
                              key={idx}
                              onClick={() => playOnlineSong(song)}
                              className={`w-full p-2 flex items-center gap-3 rounded-lg transition-all text-left group ${currentTrack?.id === song.id ? 'bg-blue-500/10 border border-blue-500/20' : 'hover:bg-white/5'}`}
                            >
                              <div className="w-6 h-6 rounded flex items-center justify-center bg-white/5 text-[10px] text-white/20 group-hover:text-blue-400">
                                {currentTrack?.id === song.id ? '▶' : idx + 1}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={`text-[11px] ${currentTrack?.id === song.id ? 'text-blue-200' : 'text-white/60'} truncate`}>{song.name}</p>
                                <p className="text-[9px] text-white/20 truncate">{song.artist}</p>
                              </div>
                            </button>
                          ))}
                        </>
                      )
                    )}

                    {/* --- 模式：每日推荐 --- */}
                    {musicMode === 'recommend' && (
                      <>
                        <p className="text-[9px] text-white/20 uppercase tracking-[0.2em] mb-2 px-1">📅 每日推荐 ({recommendSongs.length})</p>
                        {recommendSongs.map((song, idx) => (
                          <button
                            key={idx}
                            onClick={() => playOnlineSong(song)}
                            className={`w-full p-2 flex items-center gap-3 rounded-lg transition-all text-left group ${currentTrack?.id === song.id ? 'bg-blue-500/10 border border-blue-500/20' : 'hover:bg-white/5'}`}
                          >
                            <div className="w-8 h-8 rounded overflow-hidden bg-white/5 relative">
                              <img src={song.albumArt} className="w-full h-full object-cover opacity-60 group-hover:opacity-100" />
                              <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                                <span className="text-[10px] text-white">{currentTrack?.id === song.id ? '▶' : ''}</span>
                              </div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`text-[11px] ${currentTrack?.id === song.id ? 'text-blue-200' : 'text-white/60'} truncate`}>{song.name}</p>
                              <p className="text-[9px] text-white/20 truncate">{song.artist} - {song.album}</p>
                            </div>
                          </button>
                        ))}
                      </>
                    )}

                    {/* --- 模式：私人 FM --- */}
                    {musicMode === 'fm' && (
                      <div className="h-full flex flex-col items-center justify-center p-4">
                        <div className={`w-40 h-40 rounded-full border-4 border-white/5 mb-6 relative overflow-hidden ${isPlaying ? 'animate-[spin_20s_linear_infinite]' : ''}`}>
                          <img src={currentTrack?.albumArt || "https://y.gtimg.cn/mediastyle/global/img/person_300.png"} className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/20" />
                        </div>
                        <h3 className="text-sm font-medium text-white mb-2 text-center">{currentTrack?.name || "这里是私人 FM"}</h3>
                        <p className="text-[10px] text-white/40 mb-8">{currentTrack?.artist || "听懂你的心声"}</p>

                        <div className="flex gap-4">
                          <button onClick={() => { /* 喜欢逻辑暂留坑 */ alert('喜欢功能开发中') }} className="w-10 h-10 rounded-full bg-white/5 hover:bg-red-500/20 text-white/40 hover:text-red-500 border border-white/10 flex items-center justify-center transition-all">
                            ❤
                          </button>
                          <button onClick={playNextFM} className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 text-white border border-white/10 flex items-center justify-center transition-all">
                            ➡
                          </button>
                        </div>
                        <p className="text-[9px] text-white/10 mt-6">算法根据您的听歌历史实时推荐</p>
                      </div>
                    )}

                    {/* --- 模式：听歌排行 --- */}
                    {musicMode === 'history' && (
                      <>
                        <p className="text-[9px] text-white/20 uppercase tracking-[0.2em] mb-2 px-1">🏆 本周听歌排行</p>
                        {historySongs.map((song, idx) => (
                          <button
                            key={idx}
                            onClick={() => playOnlineSong(song)}
                            className={`w-full p-2 flex items-center gap-3 rounded-lg transition-all text-left group ${currentTrack?.id === song.id ? 'bg-blue-500/10 border border-blue-500/20' : 'hover:bg-white/5'}`}
                          >
                            <div className="w-6 h-6 rounded flex items-center justify-center bg-white/5 font-mono font-bold text-xs italic text-white/10 group-hover:text-amber-500">
                              {idx + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`text-[11px] ${currentTrack?.id === song.id ? 'text-blue-200' : 'text-white/60'} truncate`}>{song.name}</p>
                              <div className="flex items-center gap-2">
                                <div className="h-1 bg-white/5 rounded-full flex-1 overflow-hidden">
                                  <div className="h-full bg-amber-500/50" style={{ width: `${song.score}%` }} />
                                </div>
                              </div>
                            </div>
                          </button>
                        ))}
                      </>
                    )}
                  </div>

                  {/* 当前播放 */}
                  <div className={`pt-4 border-t border-white/10 transition-all duration-500 ${currentTrack ? 'opacity-100 translate-y-0' : 'opacity-20 translate-y-4 pointer-events-none'}`}>
                    <div className="flex items-center gap-3 mb-4">
                      <div className={`w-12 h-12 rounded-full overflow-hidden border border-blue-500/50 ${isPlaying ? 'animate-[spin_10s_linear_infinite]' : ''}`}>
                        <img src={currentTrack?.albumArt || "https://y.gtimg.cn/music/photo_new/T002R300x300M000002e3nFs3ZIs62.jpg"} className="w-full h-full object-cover" alt="album" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-blue-100 truncate">{currentTrack?.name || "未在播放"}</p>
                        <p className="text-[10px] text-white/30 truncate">{currentTrack?.artist || "星辰旋律"}</p>
                      </div>
                    </div>

                    {/* 歌词动态显示 (面板版) */}
                    <div className="h-10 flex items-center justify-center text-center px-2 mb-4 bg-white/5 rounded-xl border border-white/5">
                      <p className="text-[10px] text-blue-200/70 italic line-clamp-1">
                        {currentLyric || (lyrics.length > 0 ? "～ 宇宙信号同步中 ～" : "暂无歌词数据")}
                      </p>
                    </div>

                    <div className="flex justify-between gap-2">
                      <button className="flex-1 py-2 bg-white/5 hover:bg-white/10 rounded-full text-xs transition-all">⏮</button>
                      <button
                        onClick={togglePlay}
                        className="flex-1 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded-full text-xs transition-all"
                      >
                        {isPlaying ? "⏸" : "▶"}
                      </button>
                      <button className="flex-1 py-2 bg-white/5 hover:bg-white/10 rounded-full text-xs transition-all">⏭</button>
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={() => { setMusicUser(null); setLoginQR(null); setCookie(''); }}
                className="mt-4 py-2 text-[9px] text-white/20 hover:text-red-400/60 uppercase tracking-widest transition-all"
              >
                断开连接
              </button>
            </div>
          </div>
        </>
      )}

      {/* --- 全局顶部悬浮歌词 (UI Mirror) --- */}
      {
        showLyrics && currentLyric && isStarted && (
          <div className="fixed top-[8%] left-1/2 -translate-x-1/2 z-[999] pointer-events-none w-full max-w-4xl px-4 flex flex-col items-center">
            <div className="lyric-mirror-container">
              <p className="lyric-mirror-text" style={{ fontSize: `${lyricScale * 24}px` }}>
                {currentLyric}
              </p>
              {/* 扫光装饰线 */}
              <div className="lyric-mirror-scanline" />
            </div>
          </div>
        )
      }
    </div>
  );
}
