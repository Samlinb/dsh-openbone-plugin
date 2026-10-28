# OpenBone Studio for DSH

[简体中文](README.zh-CN.md)

Create and refine skeletal animations through conversation in DSH, then play the result in your browser. OpenBone Studio includes a Web Runtime for animation previews.

## Install

In DSH, open the plugin installer and enter:

```text
dsh-openbone-plugin@0.2.4
```

Restart the DSH profile after installation. You can also install through the CLI:

```sh
dsh plugin --profile <your-profile> add dsh-openbone-plugin@0.2.4
```

Use the profile that runs your DSH Web or desktop application.

## Connect

You need a compatible DSH release, Node.js 24.9 or later, and an available OpenBone service. Ask your service administrator for the connection address and access key.

The DSH server needs these environment variables:

| Variable | Value |
| --- | --- |
| `OPENBONE_LIBRARY_URL` | The service address supplied by your administrator |
| `OPENBONE_LIBRARY_TOKEN` | The access key supplied by your administrator |

For a remote DSH Web installation, configure them on the machine running DSH. Restart DSH after changing the connection settings.

## Start an animation task

Open a chat with the plugin enabled and ask it to connect to an available project:

> List the available OpenBone projects and connect this chat to the character I want to work on.

Then inspect its animations:

> Show me the animations in this project and describe the current walk cycle.

Describe a focused change and review the result:

> Make the walk cycle's arm swing a little smaller, then show me a preview.

You can also ask for a suitable motion reference:

> Find a reference for a short-legged character's walk and help me start a new project from it.

If the new project is not available for connection yet, ask your administrator to make it available before continuing.

## Watch the preview

Ask DSH to generate a preview, then open the returned link in DSH's browser or your browser.

The player supports:

- Animation and skin selection.
- Play, pause, looping and playback speed.
- Timeline seeking and fit-to-view.
- PNG capture.
- English and Chinese controls.
- OpenBone or Spine WebGL playback selection.

Spine WebGL is subject to its included license notices.

After another edit, ask for a new preview. An already-open preview does not automatically switch to the latest edit. If a link expires, request another one.

## Refine and save

Give feedback about what you see:

> The landing feels too abrupt. Soften the body's rotation near the end and show the result again.

To revert a change:

> Undo the last edit and generate a fresh preview.

When you are satisfied:

> Save the current OpenBone project.

Save your work before the OpenBone service is restarted. Each chat can connect to a project; to switch projects, ask DSH to list the available projects and change the connection.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| The plugin is unavailable after installation | Restart the same DSH profile where it was installed. |
| DSH cannot connect | Ask your administrator to check the service address, access key and service status. |
| No project is available | Ask your administrator to make the project available, then list projects again. |
| The preview shows an earlier edit | Request a new preview after the edit. |
| The preview link has expired | Ask DSH to generate another preview. |
| Saving or editing reports a conflict | Ask DSH to read the current project state before continuing. |

The plugin includes the preview player. An OpenBone service connection is still required to edit and save projects.
