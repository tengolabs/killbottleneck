"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"
import { useSpodekHlavicky } from "@/hooks/useSpodekHlavicky"

// Dialogy POD horní lištou (Richard 27. 10. 2026: „i v nastavení ať máš pořád horní lištu“ — všechno, na co se
// kliká pod panáčkem): v obalu <PodListouProvider> (UserMenu) je dialog NEmodální, závoj i okno začínají pod
// ukotvenou lištou a lišta zůstává klikací — klik do ní (zvoneček, panáček, navigace) dialog NEzavře, aby
// rozepsaný formulář nezmizel; klik do závoje zavírá jako dosud. Mimo obal (brány, editor uzlu…) beze změny.
const PodListouCtx = React.createContext(false)
const PodListouProvider = ({ children }) => <PodListouCtx.Provider value={true}>{children}</PodListouCtx.Provider>

// Zámek rolování těla po dobu OTEVŘENÉHO dialogu pod lištou (Radix ho v nemodálním režimu nedrží).
// Sedí na kořeni (zná `open`), NE na DialogContent: ten je v DOM stromu React i u zavřeného dialogu
// (UserMenu drží všech 10 dialogů namontovaných s open=false) a zámek pak platil trvale → od v0.90-beta
// nešlo kolečkem rolovat na titulce, v úkolech ani v kalendáři (Richard 28. 10. 2026). Nekontrolovaný
// dialog (bez `open`) si stav hlídá sám přes onOpenChange.
const Dialog = ({ open, defaultOpen, onOpenChange, ...props }) => {
  const podListou = React.useContext(PodListouCtx)
  const [vnitrni, setVnitrni] = React.useState(!!defaultOpen)
  const otevren = open !== undefined ? open : vnitrni
  const zmena = React.useCallback((v) => { setVnitrni(v); if (onOpenChange) onOpenChange(v) }, [onOpenChange])
  React.useEffect(() => {
    if (!podListou || !otevren) return undefined
    const puvodni = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = puvodni }
  }, [podListou, otevren])
  return <DialogPrimitive.Root {...props} open={open} defaultOpen={defaultOpen} onOpenChange={zmena} modal={podListou ? false : props.modal} />
}

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props} />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

// size="full" = skoro celoobrazovkové okno (editor uzlu s levým menu kategorií,
// n8n styl — Richard 14. 8. 2026). Default beze změny: max-w-lg, přebíjí se
// className (mimo PodListouProvider se žádný stávající dialog nemění).
// Pod lištou (PodListouProvider, 27. 10. 2026) je dialog NEMODÁLNÍ: Radix pak nezamyká rolování těla ani nedrží
// fokus uvnitř okna — rolování těla zamyká kořen Dialog (jen OTEVŘENÝ), ztráta focus-trapu je vědomý kompromis za
// klikací lištu (zvoneček, panáček) nad otevřeným dialogem.
// overlayClassName = jiný závoj kolem okna (výběr vzhledu: skoro průhledný, ať je změna skinu vidět — Richard 19. 10. 2026)
const DialogContent = React.forwardRef(({ className, children, size, overlayClassName, onInteractOutside, ...props }, ref) => {
  const podListou = React.useContext(PodListouCtx)
  const spodek = useSpodekHlavicky(podListou)
  // v nemodálním režimu Radix závoj nekreslí → vlastní, od spodní hrany lišty; okno vystředěné v pásu pod lištou
  const stylPod = podListou ? { top: `calc(50% + ${spodek / 2}px)`, ...(size === "full" ? { height: `calc(100dvh - ${spodek}px - 2rem)` } : { maxHeight: `calc(100dvh - ${spodek}px - 2rem)` }) } : undefined
  const mimo = (e) => {
    if (podListou) {
      const cil = e.target
      // lišta (vč. proužku) a rozbalovací nabídky z ní (zvoneček, panáček — portály Radix) dialog nezavírají;
      // ani oznámení (toasty): leží přes okno a klik do nich („Klíč vytvořen“ přes tlačítko Kopírovat v API klíčích,
      // regrese 27. 10. 2026) nesmí zahodit rozepsaný formulář
      if (cil && cil.closest && cil.closest('[data-app-header-obal], [data-app-header], [data-radix-popper-content-wrapper], [data-testid="toast-viewport"]')) e.preventDefault()
    }
    if (onInteractOutside) onInteractOutside(e)
  }
  return (
  <DialogPortal>
    {podListou
      ? <div data-dialog-zavoj className={cn("fixed left-0 right-0 bottom-0 z-50 bg-black/80 animate-in fade-in-0", overlayClassName)} style={{ top: spodek }} />
      : <DialogOverlay className={overlayClassName} />}
    <DialogPrimitive.Content
      ref={ref}
      data-pod-listou={podListou ? "1" : undefined}
      style={stylPod}
      onInteractOutside={mimo}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
        size === "full" ? "w-[96vw] max-w-[1400px] h-[92dvh] p-0 overflow-hidden" : "max-w-lg",
        podListou && size !== "full" ? "overflow-y-auto" : "",
        className
      )}
      {...props}>
      {children}
      <DialogPrimitive.Close
        className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}) => (
  <div
    className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)}
    {...props} />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props} />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props} />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props} />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  PodListouProvider,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
