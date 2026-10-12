# Claude permissions

`settings.json` is intentionally minimal because framework, commands, OS and installed Claude Code version are not yet known. It does **not** fully enforce protected folders. The User must configure explicit allowed/denied tools or sandbox/file access in the actual runtime and verify behavior before granting Claude execution rights. Claude must not edit this folder.
