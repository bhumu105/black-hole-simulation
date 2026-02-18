# black hole simulation

so i made a black hole simulation in C++ that actually runs on your GPU using compute shaders — it simulates gravitational lensing, an accretion disk, and spacetime curvature. there's a 2D and 3D version.

if you haven't seen the video that explains everything, check it out here: https://www.youtube.com/watch?v=8-B6ryuBkCM

---

## what it does

- **2D** — gravitational lensing simulation, simple and fast
- **3D** — full black hole render using `black_hole.cpp` + `geodesic.comp` (compute shader handles the heavy math on the GPU via a UBO)

---

## what you need

- C++ compiler (C++17 or newer)
- [CMake](https://cmake.org/)
- [vcpkg](https://vcpkg.io/en/)
- [Git](https://git-scm.com/)

---

## how to build

1. clone the repo
   ```bash
   git clone https://github.com/bhumu105/black-hole-simulation.git
   cd black-hole-simulation
   ```

2. install dependencies
   ```bash
   vcpkg install
   vcpkg integrate install
   ```
   this gives you a toolchain path that looks like:
   `-DCMAKE_TOOLCHAIN_FILE=/path/to/vcpkg/scripts/buildsystems/vcpkg.cmake`

3. build with cmake
   ```bash
   mkdir build
   cmake -B build -S . -DCMAKE_TOOLCHAIN_FILE=/your/path/here/vcpkg.cmake
   cmake --build build
   ```

4. run it — executables will be in the `build/` folder

---

## linux / ubuntu shortcut

if you don't want to mess with vcpkg just install these and run the cmake steps above:

```bash
sudo apt update
sudo apt install build-essential cmake \
    libglew-dev libglfw3-dev libglm-dev libgl1-mesa-dev
```

---

## notes

- i've only tested this on windows with my own GPU so no guarantees on other setups lol
- lmk if anything breaks or if you want a more in depth breakdown of how the code works :)
