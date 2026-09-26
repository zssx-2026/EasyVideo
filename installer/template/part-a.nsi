; EasyVideo installer - part A: metadata, defines, pages, languages, strings.
Unicode true
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "StrFunc.nsh"

${StrLoc}
${UnStrLoc}
${StrRep}
${UnStrRep}

Name 'EasyVideo'
OutFile 'EasyVideo-Setup.exe'
InstallDir '$LOCALAPPDATA\EasyVideo'
InstallDirRegKey HKCU 'Software\EasyVideo' 'InstallDir'
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUninstDetails show
VIProductVersion '1.0.0.0'
VIAddVersionKey 'ProductName' 'EasyVideo'
VIAddVersionKey 'FileDescription' 'EasyVideo Setup'
VIAddVersionKey 'FileVersion' '1.0.0.0'
VIAddVersionKey 'ProductVersion' '1.0.0.0'
VIAddVersionKey 'CompanyName' 'EasyVideo'
VIAddVersionKey 'LegalCopyright' 'EasyVideo'

!define EV_CACHE '$TEMP\EasyVideo\cache'
!define EV_PAYLOAD '$TEMP\EasyVideo\cache\payload'
!define EV_FILES_KEY 'Software\EasyVideo\Files'
!define EV_APPKEY 'Software\EasyVideo'
!define EV_UNKEY 'Software\Microsoft\Windows\CurrentVersion\Uninstall\EasyVideo'

Var EvMode
Var EvExist
Var EvRadioRe
Var EvRadioRep
Var EvRadioDel
Var EvDlg

!define MUI_ABORTWARNING
!define MUI_ICON 'icon.ico'
!define MUI_UNICON 'icon.ico'
!define MUI_LANGDLL_ALLLANGUAGES
!define MUI_FINISHPAGE_NOAUTOCLOSE
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT '$(EV_SEC_RUN)'
!define MUI_FINISHPAGE_RUN_FUNCTION EvLaunch
!define MUI_WELCOMEPAGE_TEXT '$(EV_WELCOME)'

!insertmacro MUI_PAGE_WELCOME
Page custom EvExistingPage EvExistingLeave
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

!insertmacro MUI_LANGUAGE 'SimpChinese'
!insertmacro MUI_LANGUAGE 'TradChinese'
!insertmacro MUI_LANGUAGE 'English'
!insertmacro MUI_LANGUAGE 'Japanese'
!insertmacro MUI_LANGUAGE 'Korean'
!insertmacro MUI_LANGUAGE 'German'
!insertmacro MUI_LANGUAGE 'French'
!insertmacro MUI_LANGUAGE 'Russian'
!insertmacro MUI_LANGUAGE 'Spanish'
!insertmacro MUI_LANGUAGE 'PortugueseBR'

