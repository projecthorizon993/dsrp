# Windows binding compatibility

Source: crates.io `gpu-allocator` 0.28.0, upstream commit `3d4466e3331c43d1f85b937b775427b07d7a32fe`. Original registry archive SHA-256: `51255ea7cfaadb6c5f1528d43e92a82acb2b96c43365989a28b2d44ee38f8795`. Retains upstream source, manifest provenance and MIT/Apache-2.0 licenses.

Only Cargo.toml changes: Windows binding bounds use `>=0.62, <0.63` instead of the upstream `>=0.53, <=0.62`. No allocator or rendering source changes. Workspace Cargo.lock controls resolution; the upstream crate lockfile is omitted.

The upper bound alone was not enough. `<0.63` merely *permits* Windows 0.62 patch releases, and because the committed lockfile already pinned this crate to Windows 0.61.3, Cargo had no reason to move it. That left `gpu-allocator` on `windows 0.61.3` while `wgpu-hal` 30.0.1 resolved to `windows 0.62.2`, and the Direct3D backend failed to compile: `wgpu-hal` expects `windows::Win32::Graphics::Direct3D12::ID3D12Device` but `gpu_allocator::d3d12` supplies a different crate's type, so `ID3D12DeviceVersion::Device(raw.clone())` is a mismatched type and `ResourceCategory: From<&D3D12_RESOURCE_DESC>` is unsatisfied. The lower bound is what forces the two onto the same interface; the upper bound is what keeps a future 0.63 from re-breaking it the other way.

`cargo update -p gpu-allocator` must be re-run if this bound is ever changed, and the result checked: `gpu-allocator` has to appear in `Cargo.lock` with `windows 0.62.2`, the same entry `wgpu-hal` uses.

Remove this patch when an upstream compatible release accepts Windows 0.62 patch releases. Windows x64 and ARM native CI builds validate the Direct3D backend.
