import { useState } from "react"
import { NavItemType, navItems } from "../data/nav"

const NavItem = (item: NavItemType) => {
    return <a href={item.path}>
        <button className="p-2 w-full bg-black/20 hover:bg-green-300 hover:text-black text-[#78e2a0]">
            {item.name}
        </button>
    </a>
}

export default function Navbar() {
    const [mobileVisible, setMobileVisible] = useState(false)

    return <div>
        <nav className="flex mb-5 items-center justify-between">
            <a href="/">
                <div className="bg-[#78e2a0] text-black w-fit p-2">Ankush Singh</div>
            </a>
            <div className="gap-1 flex-col hidden xl:flex-row xl:flex">
                {
                    navItems.map((item: NavItemType, _: number) => {
                        return <NavItem key={_} {...item} />
                    })
                }
            </div>
            <button className="flex xl:hidden ring-1 ring-[#78e2a0] text-[#78e2a0] p-2 relative" onClick={() => setMobileVisible(!mobileVisible)}>
                menu
                {
                    mobileVisible && <div className="absolute -left-20 ml-1 top-11 bg-black/20 backdrop-blur-2xl">
                        {
                            navItems.map((item: NavItemType, _: number) => {
                                return <NavItem key={_} {...item} />
                            })
                        }
                    </div>
                }
            </button>
        </nav>
    </div>
}