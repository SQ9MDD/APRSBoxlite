#ifndef AppVersion
  #error AppVersion must be supplied to ISCC.
#endif
#ifndef AppSource
  #error AppSource must point to the packaged Windows application directory.
#endif

[Setup]
AppId={{A6C420F8-C4E9-4B55-8DB4-A65043E8EA08}
AppName=APRSBox Lite
AppVersion={#AppVersion}
AppPublisher=SQ9MDD
DefaultDirName={autopf}\APRSBox Lite
DefaultGroupName=APRSBox Lite
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
SetupIconFile=..\..\assets\aprsbox.ico
UninstallDisplayIcon={app}\APRSBOX.exe
OutputBaseFilename=APRSBoxLite-{#AppVersion}-Windows-x64-Setup
Compression=lzma2
SolidCompression=yes

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
Source: "{#AppSource}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\APRSBox Lite"; Filename: "{app}\APRSBOX.exe"
Name: "{autodesktop}\APRSBox Lite"; Filename: "{app}\APRSBOX.exe"; Tasks: desktopicon
