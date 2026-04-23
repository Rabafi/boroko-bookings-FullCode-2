!ifdef BUILD_UNINSTALLER
  !include nsDialogs.nsh
  !include LogicLib.nsh

  Var BorokoDeleteDataCheckbox
  Var BorokoDeleteDataChoice

  ; Add a pre-uninstall choice so users can keep or remove local app data.
  !macro customUnInit
    StrCpy $BorokoDeleteDataChoice "0"
  !macroend

  !macro customUnWelcomePage
    !insertmacro MUI_PAGE_INIT
    UninstPage custom un.BorokoDeleteDataPageCreate un.BorokoDeleteDataPageLeave
  !macroend

  Function un.BorokoDeleteDataPageCreate
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 24u "Boroko Bookings will be removed from this computer."
    Pop $0

    ${NSD_CreateLabel} 0 30u 100% 34u "If you want to erase the local sessions, profiles, cache, and backups stored on this PC, check the box below."
    Pop $0

    ${NSD_CreateCheckbox} 0 72u 100% 12u "Delete local app data from this PC"
    Pop $BorokoDeleteDataCheckbox

    nsDialogs::Show
  FunctionEnd

  Function un.BorokoDeleteDataPageLeave
    ${NSD_GetState} $BorokoDeleteDataCheckbox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $BorokoDeleteDataChoice "1"
    ${Else}
      StrCpy $BorokoDeleteDataChoice "0"
    ${EndIf}
  FunctionEnd

  !macro customUnInstall
    ${If} $BorokoDeleteDataChoice == "1"
      ${If} $installMode == "all"
        SetShellVarContext current
      ${EndIf}

      RMDir /r "$APPDATA\${APP_FILENAME}"
      !ifdef APP_PRODUCT_FILENAME
        RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
      !endif
      !ifdef APP_PACKAGE_NAME
        RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
      !endif

      ${If} $installMode == "all"
        SetShellVarContext all
      ${EndIf}
    ${EndIf}
  !macroend
!endif
