// electron.vite.config.js
import fs from "fs";
import { resolve, dirname } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
var __electron_vite_injected_dirname = "C:\\Users\\Botswapelo Studios\\Documents\\Work\\Boroko Bookings";
var allowedRendererHost = process.env.ELECTRON_RENDERER_ALLOWED_HOST?.trim();
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin(),
      // database.js is a pre-compiled binary module that Vite cannot parse due to null bytes.
      // We mark it as external so Rollup doesn't try to bundle it, then manually copy it
      // to the output directory so the bundled code can find it at runtime.
      (() => {
        let outDir = resolve(__electron_vite_injected_dirname, "out/main");
        const dbPath = resolve(__electron_vite_injected_dirname, "src/main/database.js");
        return {
          name: "database-binary-handler",
          enforce: "pre",
          configResolved(config) {
            outDir = resolve(config.root, config.build.outDir || "out/main");
          },
          resolveId(source, importer) {
            if (source.includes("database.js") || source === "./database" || importer && resolve(dirname(importer), source) === dbPath) {
              return { id: "./database.js", external: true };
            }
            return null;
          },
          writeBundle() {
            const srcPath = dbPath;
            const destPath = resolve(outDir, "database.js");
            try {
              if (fs.existsSync(srcPath)) {
                if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
                fs.copyFileSync(srcPath, destPath);
              }
            } catch (e) {
              console.error("Failed to copy database.js binary:", e);
            }
          }
        };
      })()
    ]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    server: allowedRendererHost ? { allowedHosts: [allowedRendererHost] } : {},
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src")
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/react") || id.includes("node_modules/react-dom") || id.includes("node_modules/react-router-dom")) {
              return "react-vendor";
            }
            if (id.includes("node_modules/lucide-react")) {
              return "icons";
            }
            if (id.includes("node_modules/date-fns")) {
              return "dates";
            }
            if (id.includes("node_modules/@supabase/supabase-js")) {
              return "supabase";
            }
            if (id.includes("node_modules/xlsx")) {
              return "xlsx";
            }
            return void 0;
          }
        }
      }
    }
  }
});
export {
  electron_vite_config_default as default
};
