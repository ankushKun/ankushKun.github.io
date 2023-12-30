type NavItemType = {
    name: string,
    path: string
}

const navItems: NavItemType[] = [
    {
        name: "Projects",
        path: "/projects"
    },
    {
        name: "Timeline",
        path: "/timeline"
    },
    {
        name: "Achievements",
        path: "/achievements"
    },
    // {
    //     name: "Blog",
    //     path: "/blog"
    // },
    {
        name: "Charges",
        path: "/charges"
    },
    {
        name: "Links",
        path: "/links"
    }
]

export { navItems }
export type { NavItemType }