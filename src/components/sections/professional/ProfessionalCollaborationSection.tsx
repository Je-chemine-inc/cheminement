"use client";

import { motion, Variants } from "framer-motion";
import Image from "next/image";

const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease: "easeOut",
    },
  },
};

export default function ProfessionalCollaborationSection() {

  return (
    <section className="py-16 md:py-24 bg-background">
      <div className="container mx-auto px-6">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={fadeInUp}
          className="max-w-6xl mx-auto"
        >
          <div className="rounded-2xl overflow-hidden bg-linear-to-br from-primary/5 via-primary/10 to-primary/5 border border-primary/20 shadow-xl">
            <div className="relative h-[400px] md:h-[500px] lg:h-[600px] w-full">
              <Image
                src="/professional-collaboration.jpg?v=2"
                alt="Collaboration et travail d'équipe entre professionnels de la santé mentale"
                fill
                className="object-cover"
                priority
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 90vw, 1200px"
                unoptimized
              />
              {/* A dark shade under the text only: the photo keeps its colours above it, and white
                  text reads on it. (A pale veil over the whole image washed the photo out and still
                  left grey text hard to read.) */}
              <div
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-[75%] bg-linear-to-t from-[#0F2A31]/90 via-[#0F2A31]/45 to-transparent"
              />
              <div
                aria-hidden
                className="absolute inset-0 bg-linear-to-r from-[#0F2A31]/35 via-transparent to-transparent"
              />

              {/* Content overlay */}
              <div className="absolute inset-0 flex items-end">
                <div className="w-full p-8 md:p-12 lg:p-16">
                  <div className="max-w-3xl">
                    <motion.h2
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.2, duration: 0.6 }}
                      className="text-2xl md:text-3xl lg:text-4xl font-serif font-normal text-white mb-4 leading-tight [text-shadow:0_2px_12px_rgba(0,0,0,0.25)]"
                    >
                      Rejoignez une communauté de professionnels dédiés
                    </motion.h2>
                    <motion.p
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.3, duration: 0.6 }}
                      className="text-base md:text-lg lg:text-xl text-white/85 font-normal leading-relaxed"
                    >
                      Ensemble, nous créons un réseau de soutien et de
                      collaboration pour offrir les meilleurs soins à nos
                      clients. Votre expertise fait partie d&apos;une équipe
                      unie.
                    </motion.p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
