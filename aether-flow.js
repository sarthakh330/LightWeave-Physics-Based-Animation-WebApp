class AetherFlow {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.world = null;
        this.orbs = [];
        this.particles = [];
        this.mouse = { x: 0, y: 0, isPressed: false };
        this.fluidShader = null;
        this.particleSystem = null;
        this.cursorIndicator = null;
        
        this.init();
    }

    init() {
        this.setupThreeJS();
        this.setupPhysics();
        this.setupShaders();
        this.setupEventListeners();
        this.animate();
    }

    setupThreeJS() {
        // Scene setup
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.Fog(0x0a0a0a, 50, 200);

        // Camera setup
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.z = 50;

        // Renderer setup
        this.renderer = new THREE.WebGLRenderer({
            canvas: document.getElementById('canvas'),
            antialias: true,
            alpha: true
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(0x0a0a0a, 1);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        // Load environment map for reflections/refractions on orbs from CDN
        const rgbeLoader = new THREE.RGBELoader();
        rgbeLoader.load('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/venice_sunset_1k.hdr', (texture) => {
            texture.mapping = THREE.EquirectangularReflectionMapping;
            this.scene.environment = texture;
            this.scene.environment.needsUpdate = true; // Ensure environment map is updated
            
            // CRITICAL: Create orbs and particles *after* environment map is loaded
            this.createOrbs();
            this.createParticleSystem();
        });

        // Add lights to the scene
        const ambientLight = new THREE.AmbientLight(0x808080, 2); // Increased intensity and slightly brighter ambient light
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xc0e0ff, 0.8); // Softer, bluish directional light
        directionalLight.position.set(50, 70, 50); // Adjusted position for slightly different angle
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 1024;
        directionalLight.shadow.mapSize.height = 1024;
        directionalLight.shadow.camera.near = 0.5;
        directionalLight.shadow.camera.far = 500;
        this.scene.add(directionalLight);

        // Get cursor indicator
        this.cursorIndicator = document.getElementById('cursorIndicator');
    }

    setupPhysics() {
        this.world = new CANNON.World();
        this.world.gravity.set(0, 0, 0);
        this.world.broadphase = new CANNON.NaiveBroadphase();
        this.world.solver.iterations = 10;
        this.world.defaultContactMaterial.friction = 0.1;
        this.world.defaultContactMaterial.restitution = 0.7;
    }

    setupShaders() {
        // Fluid background shader
        const fluidVertexShader = `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `;

        const fluidFragmentShader = `
            uniform float time;
            uniform vec2 mouse;
            uniform vec2 mouseVelocity;
            uniform bool mousePressed;
            
            varying vec2 vUv;
            
            // Simplex noise function
            vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
            vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
            vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
            
            float snoise(vec2 v) {
                const vec4 C = vec4(0.211324865405187,
                                  0.366025403784439,
                                 -0.577350269189626,
                                  0.024390243902439);
                vec2 i  = floor(v + dot(v, C.yy) );
                vec2 x0 = v -   i + dot(i, C.xx);
                vec2 i1;
                i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
                vec4 x12 = x0.xyxy + C.xxzz;
                x12.xy -= i1;
                i = mod289(i);
                vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
                    + i.x + vec3(0.0, i1.x, 1.0 ));
                vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
                m = m*m ;
                m = m*m ;
                vec3 x = 2.0 * fract(p * C.www) - 1.0;
                vec3 h = abs(x) - 0.5;
                vec3 ox = floor(x + 0.5);
                vec3 a0 = x - ox;
                m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
                vec3 g;
                g.x  = a0.x  * x0.x  + h.x  * x0.y;
                g.yz = a0.yz * x12.xz + h.yz * x12.yw;
                return 130.0 * dot(m, g);
            }
            
            void main() {
                vec2 uv = vUv;
                
                // Base noise for fluid texture
                float noise1 = snoise(uv * 2.0 + time * 0.06); // Slower, larger waves
                float noise2 = snoise(uv * 4.0 - time * 0.1);  // Medium waves
                float noise3 = snoise(uv * 8.0 + time * 0.03);  // Finer details
                
                float fluid = (noise1 * 0.4 + noise2 * 0.35 + noise3 * 0.25) * 0.5 + 0.5;
                
                // Mouse interaction - create ripples with more viscous feel
                vec2 mousePos = mouse;
                float dist = distance(uv, mousePos);
                float ripple = 0.0;
                
                if (dist < 0.4) { // Slightly larger influence area
                    float rippleStrength = mousePressed ? 0.5 : 0.2; // Stronger pull, subtler push
                    ripple = sin(dist * 15.0 - time * 3.0) * exp(-dist * 8.0) * rippleStrength; // Adjusted frequency and decay for a more fluid, less sharp ripple
                    
                    // Add velocity-based distortion, making it feel more like dragging through liquid
                    float velocity = length(mouseVelocity) * 0.7; // Increased velocity influence
                    ripple += sin(dist * 20.0 - time * 5.0) * exp(-dist * 10.0) * velocity * 0.4; // Adjusted frequency, decay, and strength
                }
                
                // Combine effects
                float finalFluid = fluid + ripple;
                
                // Create the aether color palette - more dynamic and subtle
                vec3 color1 = vec3(0.06, 0.03, 0.1);  // Even deeper purple
                vec3 color2 = vec3(0.03, 0.06, 0.1);  // Even deeper blue
                vec3 color3 = vec3(0.1, 0.03, 0.06);  // Even deeper magenta
                
                vec3 finalColor = mix(color1, color2, finalFluid);
                finalColor = mix(finalColor, color3, ripple * 0.9); // Stronger influence from ripple on color
                
                // Add subtle glow and a slight atmospheric tint
                finalColor += vec3(0.01, 0.015, 0.02) * (1.0 - finalFluid); // Subtle atmospheric tint
                
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `;

        // Create fluid background plane
        const fluidGeometry = new THREE.PlaneGeometry(200, 200);
        const fluidMaterial = new THREE.ShaderMaterial({
            vertexShader: fluidVertexShader,
            fragmentShader: fluidFragmentShader,
            uniforms: {
                time: { value: 0 },
                mouse: { value: new THREE.Vector2(0.5, 0.5) },
                mouseVelocity: { value: new THREE.Vector2(0, 0) },
                mousePressed: { value: false }
            }
        });

        this.fluidShader = fluidMaterial;
        const fluidPlane = new THREE.Mesh(fluidGeometry, fluidMaterial);
        fluidPlane.position.z = -10;
        this.scene.add(fluidPlane);
    }

    createOrbs() {
        const orbCount = 20;
        const colors = [
            0xffffff, // White
            0xe6f3ff, // Light blue
            0xfff0f5, // Lavender
            0xf0fff4, // Mint green
            0xfff5ee  // Dusty rose
        ];

        for (let i = 0; i < orbCount; i++) {
            const radius = Math.random() * 2 + 1;
            const color = colors[Math.floor(Math.random() * colors.length)];
            
            // Create visual orb
            const geometry = new THREE.SphereGeometry(radius, 32, 32);
            const material = new THREE.MeshPhysicalMaterial({
                color: color,
                transparent: true,
                opacity: 0.3, // Significantly reduced opacity for high transparency
                metalness: 0.0,
                roughness: 0.0, // Very low roughness for clear, sharp reflections
                transmission: 0.99, // Max transmission for full glass effect
                clearcoat: 0.0, 
                clearcoatRoughness: 0.0,
                emissive: color,
                emissiveIntensity: 0.8, // Reduced emissive intensity for a very subtle internal glow
                envMap: this.scene.environment, 
                envMapIntensity: 3.0 // Increased environment map intensity for prominent reflections
            });
            
            const orb = new THREE.Mesh(geometry, material);
            
            // Random position
            orb.position.set(
                (Math.random() - 0.5) * 80,
                (Math.random() - 0.5) * 80,
                (Math.random() - 0.5) * 20
            );
            
            // Create physics body
            const shape = new CANNON.Sphere(radius);
            const body = new CANNON.Body({
                mass: radius * 2,
                shape: shape,
                material: new CANNON.Material()
            });
            
            body.position.copy(orb.position);
            body.velocity.set(
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 1
            );
            
            // Add damping
            body.linearDamping = 0.1;
            body.angularDamping = 0.1;
            
            this.world.addBody(body);
            this.scene.add(orb);
            
            this.orbs.push({
                mesh: orb,
                body: body,
                radius: radius,
                color: color
            });
        }
    }

    createParticleSystem() {
        const particleCount = 50000; // Optimized particle count for performance and visual density
        
        // Create a circular particle texture (high resolution for smoothness)
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const context = canvas.getContext('2d');
        context.beginPath();
        context.arc(256, 256, 250, 0, Math.PI * 2, false);
        context.fillStyle = 'rgba(255, 255, 255, 1)';
        context.fill();
        const particleTexture = new THREE.CanvasTexture(canvas);
        particleTexture.minFilter = THREE.LinearFilter;
        particleTexture.magFilter = THREE.LinearFilter;
        particleTexture.needsUpdate = true;

        // Use individual Sprites for particles for better control over shape and transparency
        this.particles = [];
        for (let i = 0; i < particleCount; i++) {
            const x = (Math.random() - 0.5) * 400; // Wider spread for more particles
            const y = (Math.random() - 0.5) * 400;
            const z = (Math.random() - 0.5) * 300;  // Deeper Z range for more particles
            
            // Vary size and intensity based on Z for depth
            const zDepthFactor = 1.0 - (Math.abs(z) / 150.0); // Adjust depth influence based on new Z range
            const intensity = Math.random() * 0.8 + 0.2;
            const finalIntensity = intensity * Math.max(0.002, zDepthFactor); // Allow for very dim, distant particles

            const particleColor = new THREE.Color(
                finalIntensity * 0.9,
                finalIntensity,
                finalIntensity * 1.1
            );
            
            const particleSize = (Math.random() * 0.9 + 0.00001) * Math.max(0.008, zDepthFactor); // Wider range of sizes, down to incredibly tiny

            const particleMaterial = new THREE.SpriteMaterial({
                map: particleTexture,
                color: particleColor,
                transparent: true,
                opacity: Math.min(1.0, finalIntensity + 0.1), // Slightly more opaque base
                blending: THREE.AdditiveBlending,
                premultipliedAlpha: true
            });
            
            const particleSprite = new THREE.Sprite(particleMaterial);
            particleSprite.position.set(x, y, z);
            particleSprite.scale.set(particleSize, particleSize, 1);
            this.scene.add(particleSprite);
            
            this.particles.push({
                sprite: particleSprite,
                velocity: new THREE.Vector3(
                    (Math.random() - 0.5) * 0.002, // Reduced base velocity for more subtle drift
                    (Math.random() - 0.5) * 0.002,
                    (Math.random() - 0.5) * 0.0005
                ),
                // Add twinkle property for a small percentage
                twinkle: Math.random() < 0.001 ? Math.random() * Math.PI * 2 : -1, // Even less frequent twinkle
                originalColor: particleColor.clone(),
                originalOpacity: particleMaterial.opacity
            });
        }
    }

    setupEventListeners() {
        // Mouse movement
        document.addEventListener('mousemove', (event) => {
            this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
            this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
            
            // Update cursor indicator
            this.cursorIndicator.style.left = event.clientX + 'px';
            this.cursorIndicator.style.top = event.clientY + 'px';
            
            // Calculate mouse velocity for shader
            const mouseVelocity = new THREE.Vector2(
                this.mouse.x - (this.fluidShader.uniforms.mouse.value.x),
                this.mouse.y - (this.fluidShader.uniforms.mouse.value.y)
            );
            this.fluidShader.uniforms.mouseVelocity.value.copy(mouseVelocity);
            this.fluidShader.uniforms.mouse.value.set(this.mouse.x, this.mouse.y);
        });

        // Mouse click
        document.addEventListener('mousedown', () => {
            this.mouse.isPressed = true;
            this.cursorIndicator.classList.add('pulling');
            this.fluidShader.uniforms.mousePressed.value = true;
        });

        document.addEventListener('mouseup', () => {
            this.mouse.isPressed = false;
            this.cursorIndicator.classList.remove('pulling');
            this.fluidShader.uniforms.mousePressed.value = false;
        });

        // Window resize
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    updatePhysics() {
        this.world.step(1/60);
        
        // Update orb positions
        this.orbs.forEach(orb => {
            orb.mesh.position.copy(orb.body.position);
            orb.mesh.quaternion.copy(orb.body.quaternion);
        });
    }

    updateParticles() {
        const time = Date.now() * 0.001;
        
        for (let i = 0; i < this.particles.length; i++) {
            const particle = this.particles[i];
            
            // Get cursor position in world space
            const cursorWorldPos = new THREE.Vector3(
                this.mouse.x * 50,
                this.mouse.y * 50,
                0
            );
            
            // Calculate distance to cursor
            const distance = particle.sprite.position.distanceTo(cursorWorldPos);
            const influenceRadius = this.mouse.isPressed ? 85 : 60; // Larger influence radius for particles
            
            if (distance < influenceRadius) {
                const force = new THREE.Vector3();
                const direction = new THREE.Vector3().subVectors(particle.sprite.position, cursorWorldPos).normalize();
                
                if (this.mouse.isPressed) {
                    // Pulling force (gravity well)
                    force.copy(direction).multiplyScalar(-5.5); // Stronger pull
                } else {
                    // Pushing force
                    force.copy(direction).multiplyScalar(4.5); // Stronger push
                }
                
                // Apply force based on distance
                const strength = 1 - (distance / influenceRadius);
                force.multiplyScalar(strength);
                
                particle.velocity.add(force);
            }
            
            // Add some natural movement (extremely subtle for Apple-esque feel)
            particle.velocity.add(new THREE.Vector3(
                (Math.random() - 0.5) * 0.000000005, // Near-zero random movement
                (Math.random() - 0.5) * 0.000000005,
                (Math.random() - 0.5) * 0.000000001
            ));
            
            // Apply damping (increased for super smooth stops and no residual movement)
            particle.velocity.multiplyScalar(0.50); // Even more damping for extremely soft stops and no drift
            
            // Update position
            particle.sprite.position.add(particle.velocity);
            
            // Keep particles within bounds and wrap them around
            const boundaryX = 200; // Adjusted boundaries
            const boundaryY = 200;
            const boundaryZ = 150;

            if (particle.sprite.position.x > boundaryX) particle.sprite.position.x = -boundaryX; else if (particle.sprite.position.x < -boundaryX) particle.sprite.position.x = boundaryX;
            if (particle.sprite.position.y > boundaryY) particle.sprite.position.y = -boundaryY; else if (particle.sprite.position.y < -boundaryY) particle.sprite.position.y = boundaryY;
            if (particle.sprite.position.z > boundaryZ) particle.sprite.position.z = -boundaryZ; else if (particle.sprite.position.z < -boundaryZ) particle.sprite.position.z = boundaryZ;
            
            // Twinkle effect
            if (particle.twinkle !== -1) {
                const twinkleFactor = (Math.sin(time * 5 + particle.twinkle) * 0.5 + 0.5) * 0.00005 + 0.99995; // Oscillate between 0.99995 and 1.0, barely noticeable
                particle.sprite.material.color.copy(particle.originalColor).multiplyScalar(twinkleFactor);
                particle.sprite.material.opacity = particle.originalOpacity * twinkleFactor;
            } else {
                // Ensure non-twinkling particles retain their original color and opacity
                particle.sprite.material.color.copy(particle.originalColor);
                particle.sprite.material.opacity = particle.originalOpacity;
            }
        }
    }

    applyCursorForces() {
        const cursorWorldPos = new THREE.Vector3(
            this.mouse.x * 50,
            this.mouse.y * 50,
            0
        );
        
        this.orbs.forEach(orb => {
            const distance = new THREE.Vector3().subVectors(orb.body.position, cursorWorldPos);
            const distLength = distance.length();
            
            if (distLength < 60) { // Reduced influence radius for a more subtle interaction
                const force = new CANNON.Vec3();
                const direction = distance.normalize();
                
                if (this.mouse.isPressed) {
                    // Pulling force (gravity well)
                    force.copy(direction).scale(-200); // Reduced pulling force
                } else {
                    // Pushing force
                    force.copy(direction).scale(80); // Reduced pushing force
                }
                
                // Apply force based on distance
                const strength = 1 - (distLength / 60);
                force.scale(strength, force);
                
                orb.body.applyForce(force, orb.body.position);
            }
        });
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        
        const time = Date.now() * 0.001;
        
        // Update shader time
        this.fluidShader.uniforms.time.value = time;
        
        // Update physics
        this.updatePhysics();
        
        // Apply cursor forces
        this.applyCursorForces();
        
        // Update particles
        this.updateParticles();
        
        // Render
        this.renderer.render(this.scene, this.camera);
    }
}

// Initialize the Aether Flow when the page loads
window.addEventListener('load', () => {
    new AetherFlow();
}); 