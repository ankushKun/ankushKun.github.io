import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
    return (
        <Html lang="en">
            <Head>
                <title>Ankush Singh</title>
                <link rel="icon" href="/icon.ico" />
                <link rel="icon" href="/icon.svg" type="image/svg" />
                <link rel="apple-touch-icon" href="/icon.png" type="image/png" />

                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <meta name="theme-color" content="#000000" />
                <meta name="og:title" content="Ankush Singh" />
                <meta name="og:description" content="Want to know more about me?" />
                <meta name="og:image" content="/icon.png" />
                <meta name="og:url" content="https://ankushkun.github.io" />
                <meta name="og:type" content="website" />
                <meta name="og:site_name" content="ankushKun.github.io" />
            </Head>
            <body>
                <Main />
                <NextScript />
            </body>
        </Html>
    );
}
