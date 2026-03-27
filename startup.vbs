Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "pm2 resurrect", 0, False
