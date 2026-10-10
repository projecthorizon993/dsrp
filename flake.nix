{
    description = "Tiny, performant, native Discord client written in Rust (egui/wgpu)";

    inputs = {
        nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
        flake-parts = {
            url = "github:hercules-ci/flake-parts";
            inputs.nixpkgs-lib.follows = "nixpkgs";
        };
    };

    outputs = inputs @ {
        self,
        nixpkgs,
        flake-parts,
        ...
    }:
        flake-parts.lib.mkFlake {inherit inputs;} {
            systems = [
                "x86_64-linux"
                "aarch64-darwin"
            ];

            perSystem = {
                config,
                pkgs,
                system,
                ...
            }: {
                packages.dsrp = pkgs.callPackage ./nix/package.nix {};
                packages.default = config.packages.dsrp;

                devShells.default = pkgs.mkShell {
                    name = "dsrp-dev";

                    inputsFrom = [config.packages.dsrp];
                };
            };
        };
}
