import{createPreference as e}from"/js/preferences.js?v=7075848a";const t=e("animation");export const renderToolbarAnimation=()=>{const e=document.querySelector("#toggle-anims");e.checked=n(),e.onchange=()=>{a(e.checked),o(e.checked)},o(),setTimeout((()=>{document.querySelector("#toolbar").setAttribute("data-animate","")}))};const o=(e=n())=>{e?c():m()},n=()=>!t.has()||t.get(),a=e=>t.set(e),c=()=>{document.documentElement.removeAttribute("data-animation-disabled")},m=()=>{document.documentElement.setAttribute("data-animation-disabled","")};