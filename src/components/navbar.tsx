import { useState } from "react"
import { Link as NavLink, Outlet } from "react-router-dom";
import { NavItemType, navItems } from "../data/nav"

const NavItem = (item: NavItemType) => {
    return <NavLink to={item.path}>
        <button className="p-2 w-full bg-black/20 hover:bg-green-300 hover:text-black text-[#78e2a0]">
            {item.name}
        </button>
    </NavLink>
}

export default function Navbar() {
    const [mobileVisible, setMobileVisible] = useState(false)

    return <>
        <nav className="flex mb-5 items-center justify-between relative z-30">
            <NavLink to="/">
                <div className="bg-[#78e2a0] text-black w-fit p-2">Ankush Singh</div>
            </NavLink>
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
            <Outlet />
        </nav>
    </>
}