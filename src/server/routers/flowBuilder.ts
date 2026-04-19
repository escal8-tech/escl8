import { businessProcedure, router } from "../trpc";
import { flowBuilderAgents } from "@/lib/flow-builder/registry";
import { getFlowBuilderManifestViaBot } from "@/server/services/botApi";

export const flowBuilderRouter = router({
  manifest: businessProcedure.query(async () => {
    try {
      const manifest = await getFlowBuilderManifestViaBot();
      return {
        ...manifest,
        source: manifest.source || "bot-runtime-manifest",
        fallback: false,
      };
    } catch {
      return {
        version: "dashboard-fallback",
        source: "dashboard-fallback-registry",
        fallback: true,
        agents: flowBuilderAgents,
      };
    }
  }),
});
