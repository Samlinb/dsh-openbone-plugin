# OpenBone Studio for DSH

[简体中文](README.zh-CN.md)

Create and refine skeletal animations through conversation in DSH, then play the result in your browser. OpenBone Studio includes a Web Runtime for animation previews.

## Install

Version 0.4.0 is currently delivered as a candidate archive. Select the administrator-supplied file in the DSH plugin installer:

```text
dsh-openbone-plugin-0.4.0.tgz
```

Restart the DSH profile after installation. You can also install through the CLI:

```sh
dsh plugin --profile <your-profile> add ./dsh-openbone-plugin-0.4.0.tgz
```

Use the profile that runs your DSH Web or desktop application.

## Connect

You need a compatible DSH, Node.js 24.9 or later, and the OpenBone service address. Automatic trials require DSH credential-record storage. Manual accounts also support DSH 0.2.1-rc.3 or later (below 0.3.0).

### Automatic trial

Set `OPENBONE_LIBRARY_URL` to the service root, such as `https://animation.example.com/`, leave `OPENBONE_LIBRARY_TOKEN` unset, then restart the DSH profile. The first OpenBone tool operation automatically enrolls and stores its connection in DSH's credential provider. Do not paste credentials into chat.

Retries reuse the same installation/account. Defaults are seven days and two projects; the project binding result reports the actual expiry and quota. Contact the administrator after expiry; the plugin does not silently enroll another account. Preserve DSH's credential data to keep access to your projects.

### Administrator-issued manual account

The DSH server needs these environment variables:

| Variable | Value |
| --- | --- |
| `OPENBONE_LIBRARY_URL` | The service address supplied by your administrator |
| `OPENBONE_LIBRARY_TOKEN` | Manual account access key; leave unset for automatic trials |

For a remote DSH Web installation, configure them on the machine running DSH. Restart DSH after changing the connection settings.

Hosted accounts use an address such as `https://animation.example.com/u/alice/`. Preserve the account path and trailing slash. Each account has its own access key. Your administrator supplies a private JSON file with the two environment values. Do not paste the key into chat.

For example, in PowerShell on the DSH machine:

```powershell
$connection = Get-Content -Raw ./my.credentials.json | ConvertFrom-Json
$env:OPENBONE_LIBRARY_URL = $connection.OPENBONE_LIBRARY_URL
$env:OPENBONE_LIBRARY_TOKEN = $connection.OPENBONE_LIBRARY_TOKEN
dsh --profile <your-profile>
```

For a managed DSH service, have its administrator set these variables in the service environment instead.

## Start an animation task

Open a chat with the plugin enabled and ask it to connect to an available project:

> List the available OpenBone projects and connect this chat to the character I want to work on.

A newly opened hosted account includes an empty `starter` project. Ask DSH to connect to it and create your bones and animation, or to create another empty project with a name you choose. The hosted service starts editing automatically. Your reference library starts empty until your administrator imports selected references.

Then inspect its animations:

> Show me the animations in this project and describe the current walk cycle.

Describe a focused change and review the result:

> Make the walk cycle's arm swing a little smaller, then show me a preview.

You can also ask for a suitable motion reference:

> Find a reference for a short-legged character's walk and help me start a new project from it.

Hosted services automatically start projects created from references. If an older fixed-endpoint service reports `connected: false`, ask its administrator to provision that project before connecting.

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

The hosted service restores the last saved project after restart. Read the current state again before editing; undo history and old preview links do not survive a service restart.

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

Service administrators: see [hosted deployment and onboarding](deploy/README.md).
