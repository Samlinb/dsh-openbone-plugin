---
name: openbone-studio
description: Use when creating, editing, inspecting, or previewing skeletal animation projects in OpenBone.
---

Use the OpenBone MCP tools. Choose a distinct stable lowercase workspace ID for each task, tell the user and reuse it when resuming. Workspaces are shared within an account and are not security boundaries.

Start with openbone_prepare, then openbone_client_studio. Return its exact URL as a clickable link and ask the user to open it. A tool image alone does not establish that the user saw the image. The client workbench displays local PNGs, performs pixel checks and contour cutting in the user's browser, and stores local drafts. The user can also generate and visually inspect images through their own browser-accessible model endpoints. Never call server image generation, inspection, extraction or repair, and never search server files for artwork. If the configured model does not allow browser access, explain the missing client capability; the user can generate through another client tool and import its PNG.

The user binds a compatible blank project, reviews source and cut parts, uploads the final parts, assembles and saves, then checks actual capture and confirms assembly in the workbench. Read state afterwards. Reuse the same workspace and project when continuing the animation. Do not imitate a user confirmation with model tools. A project containing another rig must be resolved before image generation; do not overwrite it. Consult references and discover editing schemas before animation. Preserve revision fences and request IDs, inspect actual captured frames, share normal-speed preview and save the final revision. Image quality, model findings and user approval are separate. Credentials stay outside chat; Codex uses an existing account.
