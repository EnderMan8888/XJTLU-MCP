import {BrowserWindow,session} from 'electron'
import {LIBRARY_HOME,LIBRARY_ORIGIN} from '../shared/library'
import type {ConnectionPhase} from '../shared/ams'
import type {AccountService} from '../services/account-service'
import {buildAutomaticLoginScript,buildLoginInspectionScript,isAuthenticationOrigin,isCredentialPage} from '../security/login-policy'

export interface LibraryAuth {token:string;accNo:number}
export class LibraryLogin {
  readonly school=session.fromPartition('persist:xjtlu-library')
  private win:BrowserWindow|null=null
  private generation=0
  private credentialsGeneration=0
  private timer:ReturnType<typeof setInterval>|null=null
  private ticking=false
  private submitted=false
  private deadline=0
  private automatic:Promise<unknown>|null=null
  private auth:LibraryAuth|null=null
  private phase:ConnectionPhase='idle'
  constructor(private account:AccountService,private publish:(phase:ConnectionPhase,message:string)=>void){
    this.school.setPermissionRequestHandler((_w,_p,callback)=>callback(false));this.school.setPermissionCheckHandler(()=>false)
    this.school.on('will-download',event=>event.preventDefault())
  }
  private status(phase:ConnectionPhase,message:string):void {this.phase=phase;this.publish(phase,message)}
  private stop():void{if(this.timer)clearInterval(this.timer);this.timer=null}
  private valid(g:number,win:BrowserWindow):boolean{return g===this.generation&&this.win===win&&!win.isDestroyed()}
  read():LibraryAuth|null{return this.auth?{...this.auth}:null}
  private allowed(raw:string):boolean{try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&['seatbookings.xjtlu.edu.cn','uim.xjtlu.edu.cn','sso.xjtlu.edu.cn'].includes(u.hostname)}catch{return false}}
  async connect(show=false):Promise<void>{
    if(this.timer){if(show)this.show();return}
    this.generation++;const g=this.generation;this.credentialsGeneration++;this.auth=null;this.submitted=false;this.deadline=Date.now()+75_000
    this.win?.destroy()
    const win=new BrowserWindow({title:'西浦图书馆 · 官方认证',width:1180,height:820,show,autoHideMenuBar:true,webPreferences:{session:this.school,nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}})
    this.win=win
    win.webContents.setWindowOpenHandler(({url})=>{if(this.allowed(url))void win.loadURL(url).catch(()=>{});return {action:'deny'}})
    win.webContents.on('will-navigate',(event,url)=>{if(!this.allowed(url))event.preventDefault()})
    win.webContents.on('will-redirect',(event,url)=>{if(!this.allowed(url))event.preventDefault()})
    win.on('closed',()=>{if(this.win!==win)return;this.win=null;this.stop();if(!this.auth)this.status('idle','认证窗口已关闭，可重新连接学校账号。')})
    this.status('authenticating','正在连接图书馆学校账号…')
    const tick=():void=>{void this.tick(g,win)}
    this.timer=setInterval(tick,750);win.webContents.on('did-finish-load',tick)
    await win.loadURL(LIBRARY_HOME).catch(()=>{if(this.valid(g,win)){this.stop();this.status('error','图书馆页面加载失败，请检查网络后重新连接。')}})
  }
  private attention(text:string):void{const first=this.phase!=='verification-required';this.status('verification-required',text);if(first)this.show()}
  private async tick(g:number,win:BrowserWindow):Promise<void>{
    if(!this.valid(g,win)||!this.timer||this.ticking||win.webContents.isLoadingMainFrame())return
    this.ticking=true
    try{
      const url=win.webContents.getURL()
      if(new URL(url).origin===LIBRARY_ORIGIN){
        const value:unknown=await win.webContents.executeJavaScript(`(()=>{if(location.origin!=='${LIBRARY_ORIGIN}')return null;try{const x=JSON.parse(sessionStorage.getItem('userInfo')||'{}');return {token:typeof x.token==='string'?x.token:'',accNo:x.accNo}}catch{return null}})()`)
        if(!this.valid(g,win))return
        if(value&&typeof value==='object'&&'token'in value&&typeof value.token==='string'&&value.token&&'accNo'in value&&typeof value.accNo==='number'&&Number.isSafeInteger(value.accNo)){
          this.auth={token:value.token,accNo:value.accNo};this.stop();this.status('connected','已连接学校账号，可查询具体座位和提交预约。');if(!win.isVisible()){win.destroy();this.win=null};return
        }
      }
      if(!isAuthenticationOrigin(url))return
      const state=await win.webContents.executeJavaScriptInIsolatedWorld(1001,[{code:buildLoginInspectionScript()}])
      if(!this.valid(g,win))return
      if(state==='verification-required'){this.attention('图书馆登录需要验证码或二次验证，请在学校窗口完成。');return}
      if(state==='login-error'){this.stop();this.status('error','学校登录未通过，请到首页核对账号密码。');return}
      if(this.phase==='verification-required'){this.deadline=Date.now()+75_000;this.status('authenticating','正在继续学校认证…')}
      if(state!=='credentials'||this.submitted||!isCredentialPage(url))return
      const cg=this.credentialsGeneration,saved=await this.account.read().catch(()=>null)
      if(!this.valid(g,win)||cg!==this.credentialsGeneration)return
      if(!saved){this.stop();this.status('credentials-required','请在首页“账号与登录”保存学校账号后连接。');return}
      this.submitted=true
      const task=win.webContents.executeJavaScriptInIsolatedWorld(1001,[{code:buildAutomaticLoginScript(saved,`library:${g}:${cg}`)}]);this.automatic=task
      let result:unknown;try{result=await task}finally{if(this.automatic===task)this.automatic=null}
      if(!this.valid(g,win)||cg!==this.credentialsGeneration)return
      if(result==='verification-required'){this.submitted=false;this.attention('请在学校窗口完成验证。')}
      else if(!['submitted','already-submitted','wrong-page','cancelled'].includes(String(result)))this.attention('登录页面需要确认，请在学校窗口完成。')
    }catch{/* SSO navigation can replace the document while it is being inspected. */}
    finally{this.ticking=false;if(this.valid(g,win)&&this.timer&&Date.now()>this.deadline&&this.phase!=='verification-required'){this.stop();this.attention('学校认证等待较久，请在官方窗口查看并完成登录。')}}
  }
  show():void{this.win?.show();this.win?.focus()}
  async openSource():Promise<void>{if(this.win&&!this.win.isDestroyed()){this.show();return};await this.connect(true)}
  invalidate():void{this.auth=null;this.status('expired','学校登录已过期，请重新连接图书馆账号。')}
  async cancel():Promise<void>{this.credentialsGeneration++;const c=this.win?.webContents;if(c&&!c.isDestroyed()&&isAuthenticationOrigin(c.getURL()))await c.executeJavaScriptInIsolatedWorld(1001,[{code:'globalThis.__xjtluLoginAttempt=null'}]).catch(()=>{});await this.automatic?.catch(()=>{})}
  async reset():Promise<void>{this.generation++;this.credentialsGeneration++;this.stop();this.auth=null;this.win?.destroy();this.win=null;await this.school.clearStorageData();this.status('idle','账号已切换，请重新连接图书馆。')}
  dispose():void{this.generation++;this.credentialsGeneration++;this.stop();this.auth=null;this.win?.destroy();this.win=null}
}
