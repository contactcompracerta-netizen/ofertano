import Header from "@/components/layout/Header";
import Hero from "@/components/home/Hero";
import Categories from "@/components/home/Categories";
import Offers from "@/components/home/Offers";
import Footer from "@/components/layout/Footer";

export default function Home() {
  return (
    <>
      <Header />

      <main>
        <Hero />

        <Categories />

        <Offers />
      </main>

      <Footer />
    </>
  );
}